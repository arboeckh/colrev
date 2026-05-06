"""Framework-native PDF share handler.

UI-native endpoints that package the PDFs on disk into a portable zip and
extract them back. PDFs live in ``data/pdfs`` which is gitignored by default
(copyright concerns — see ``colrev/constants.py``), so teams need an
out-of-band transfer path. These two endpoints are that path: zip on one
machine, hand off through any channel, unzip on the other.

Neither endpoint touches records.bib, settings, or git.
"""

from __future__ import annotations

import base64
import json
import logging
import zipfile
from datetime import datetime
from datetime import timezone
from pathlib import Path
from typing import List
from typing import Literal
from typing import Optional

from pydantic import BaseModel

from colrev.constants import Fields
from colrev.ui_jsonrpc.framework import BaseHandler
from colrev.ui_jsonrpc.framework import ProjectResponse
from colrev.ui_jsonrpc.framework import ProjectScopedRequest
from colrev.ui_jsonrpc.framework import rpc_method

logger = logging.getLogger(__name__)

MANIFEST_FILENAME = "colrev_pdfs_manifest.json"


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------


class ExportPDFsRequest(ProjectScopedRequest):
    output_path: str


class ExportPDFsResponse(ProjectResponse):
    file_count: int
    total_bytes: int
    path: str


class ImportPDFsRequest(ProjectScopedRequest):
    zip_path: str
    on_conflict: Literal["skip", "overwrite"] = "skip"


class ImportPDFsResponse(ProjectResponse):
    imported_count: int
    skipped_count: int
    overwritten_count: int
    conflicts: List[str]
    manifest_project_id: Optional[str] = None
    manifest_mismatch: bool = False


class RestorePDFFileRequest(ProjectScopedRequest):
    record_id: str
    content: str  # base64-encoded PDF bytes


class RestorePDFFileResponse(ProjectResponse):
    record_id: str
    path: str
    bytes_written: int


# ---------------------------------------------------------------------------
# Handler
# ---------------------------------------------------------------------------


class PDFShareHandler(BaseHandler):
    """Export/import PDFs as a zip for out-of-band team transfer."""

    # -- export_pdfs --------------------------------------------------------

    @rpc_method(
        name="export_pdfs",
        request=ExportPDFsRequest,
        response=ExportPDFsResponse,
    )
    def export_pdfs(self, req: ExportPDFsRequest) -> ExportPDFsResponse:
        assert self.review_manager is not None
        if not req.output_path:
            raise ValueError("output_path parameter is required")

        pdf_dir: Path = self.review_manager.paths.pdf
        output_path = Path(req.output_path).expanduser().resolve()

        output_path.parent.mkdir(parents=True, exist_ok=True)

        pdf_files: List[Path] = []
        if pdf_dir.exists() and pdf_dir.is_dir():
            pdf_files = sorted(
                p for p in pdf_dir.rglob("*") if p.is_file()
            )

        total_bytes = 0
        with zipfile.ZipFile(
            output_path, "w", compression=zipfile.ZIP_DEFLATED
        ) as zf:
            for pdf in pdf_files:
                arcname = pdf.relative_to(pdf_dir).as_posix()
                zf.write(pdf, arcname=arcname)
                total_bytes += pdf.stat().st_size

            manifest = {
                "project_id": req.project_id,
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "file_count": len(pdf_files),
                "file_list": [
                    pdf.relative_to(pdf_dir).as_posix() for pdf in pdf_files
                ],
            }
            zf.writestr(MANIFEST_FILENAME, json.dumps(manifest, indent=2))

        logger.info(
            "Exported %d PDFs (%d bytes) for project %s to %s",
            len(pdf_files), total_bytes, req.project_id, output_path,
        )

        return ExportPDFsResponse(
            project_id=req.project_id,
            file_count=len(pdf_files),
            total_bytes=total_bytes,
            path=str(output_path),
        )

    # -- import_pdfs --------------------------------------------------------

    @rpc_method(
        name="import_pdfs",
        request=ImportPDFsRequest,
        response=ImportPDFsResponse,
    )
    def import_pdfs(self, req: ImportPDFsRequest) -> ImportPDFsResponse:
        assert self.review_manager is not None
        if not req.zip_path:
            raise ValueError("zip_path parameter is required")

        zip_path = Path(req.zip_path).expanduser().resolve()
        if not zip_path.is_file():
            raise ValueError(f"Zip file not found: {zip_path}")

        pdf_dir: Path = self.review_manager.paths.pdf
        pdf_dir.mkdir(parents=True, exist_ok=True)

        imported = 0
        skipped = 0
        overwritten = 0
        conflicts: List[str] = []
        manifest_project_id: Optional[str] = None
        manifest_mismatch = False

        try:
            zf_ctx = zipfile.ZipFile(zip_path, "r")
        except zipfile.BadZipFile as exc:
            raise ValueError(f"Not a valid zip file: {zip_path}") from exc

        with zf_ctx as zf:
            try:
                with zf.open(MANIFEST_FILENAME) as fh:
                    manifest = json.loads(fh.read().decode("utf-8"))
                manifest_project_id = manifest.get("project_id")
                if (
                    manifest_project_id
                    and manifest_project_id != req.project_id
                ):
                    manifest_mismatch = True
                    logger.warning(
                        "Manifest project_id %r != current %r (continuing)",
                        manifest_project_id, req.project_id,
                    )
            except KeyError:
                logger.info("Zip has no manifest; treating as raw PDFs")
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                logger.warning("Manifest unreadable (%s); continuing", exc)

            for info in zf.infolist():
                if info.is_dir():
                    continue
                arcname = info.filename
                if arcname == MANIFEST_FILENAME:
                    continue

                # Guard against zip-slip
                target = (pdf_dir / arcname).resolve()
                try:
                    target.relative_to(pdf_dir.resolve())
                except ValueError:
                    logger.warning(
                        "Skipping %s: escapes PDF directory", arcname
                    )
                    continue

                target.parent.mkdir(parents=True, exist_ok=True)

                if target.exists():
                    if req.on_conflict == "overwrite":
                        with zf.open(info) as src, open(target, "wb") as dst:
                            dst.write(src.read())
                        overwritten += 1
                    else:
                        conflicts.append(arcname)
                        skipped += 1
                    continue

                with zf.open(info) as src, open(target, "wb") as dst:
                    dst.write(src.read())
                imported += 1

        logger.info(
            "Imported %d / skipped %d / overwrote %d PDFs for project %s",
            imported, skipped, overwritten, req.project_id,
        )

        return ImportPDFsResponse(
            project_id=req.project_id,
            imported_count=imported,
            skipped_count=skipped,
            overwritten_count=overwritten,
            conflicts=conflicts,
            manifest_project_id=manifest_project_id,
            manifest_mismatch=manifest_mismatch,
        )

    # -- restore_pdf_file ---------------------------------------------------

    @rpc_method(
        name="restore_pdf_file",
        request=RestorePDFFileRequest,
        response=RestorePDFFileResponse,
    )
    def restore_pdf_file(
        self, req: RestorePDFFileRequest
    ) -> RestorePDFFileResponse:
        """Write a single PDF file to disk for a record whose metadata
        already references it. Does not touch records.bib, settings, or
        git — this is the single-file equivalent of ``import_pdfs``, used
        when a collaborator uploaded a PDF elsewhere and the file is
        missing on this machine.
        """
        assert self.review_manager is not None

        records = self.review_manager.dataset.load_records_dict()
        if req.record_id not in records:
            raise ValueError(f"Record '{req.record_id}' not found")

        record_dict = records[req.record_id]
        file_value = record_dict.get(Fields.FILE)
        if not file_value:
            raise ValueError(
                f"Record '{req.record_id}' has no file reference — "
                "use upload_pdf instead"
            )

        try:
            pdf_bytes = base64.b64decode(req.content)
        except Exception as exc:
            raise ValueError(f"Invalid base64 content: {exc}") from exc

        target = Path(str(file_value))
        if not target.is_absolute():
            target = self.review_manager.path / target

        pdf_dir: Path = self.review_manager.paths.pdf
        try:
            target.resolve().relative_to(pdf_dir.resolve())
        except ValueError as exc:
            raise ValueError(
                f"Target path {target} is outside the PDF directory"
            ) from exc

        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "wb") as fh:
            fh.write(pdf_bytes)

        logger.info(
            "Restored PDF for %s (%d bytes) at %s",
            req.record_id, len(pdf_bytes), target,
        )

        return RestorePDFFileResponse(
            project_id=req.project_id,
            record_id=req.record_id,
            path=str(target),
            bytes_written=len(pdf_bytes),
        )
