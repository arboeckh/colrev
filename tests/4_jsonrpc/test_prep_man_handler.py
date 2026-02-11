#!/usr/bin/env python
"""Tests for the PrepManHandler JSON-RPC endpoints.

Tests cover the following endpoint:
    - prep_man_update_record: Update a record's fields and attempt
      transition from md_needs_manual_preparation to md_prepared
"""
from __future__ import annotations

import os

import pytest

import colrev.constants
import colrev.ops.init
import colrev.review_manager
from colrev.constants import Fields, FieldValues, RecordState
from colrev.ui_jsonrpc.handler import JSONRPCHandler


def _create_test_records(project_path):
    """Create test records directly in the dataset.

    Creates two records:
    - One in md_needs_manual_preparation (missing title)
    - One in md_imported (for wrong-status test)
    """
    original_cwd = os.getcwd()
    os.chdir(project_path)
    try:
        rm = colrev.review_manager.ReviewManager(
            path_str=str(project_path),
            force_mode=True,
            high_level_operation=True,
        )

        attention_record = {
            Fields.ID: "TestAttentionRecord2025",
            Fields.ENTRYTYPE: "article",
            Fields.STATUS: RecordState.md_needs_manual_preparation,
            Fields.TITLE: FieldValues.UNKNOWN,
            Fields.AUTHOR: "Smith, John",
            Fields.YEAR: "2025",
            Fields.JOURNAL: "Test Journal",
            Fields.ORIGIN: ["test_source.bib/TestAttentionRecord2025"],
            Fields.MD_PROV: {
                Fields.TITLE: {"source": "test_source.bib/TestAttentionRecord2025", "note": "missing"},
                Fields.AUTHOR: {"source": "test_source.bib/TestAttentionRecord2025", "note": ""},
                Fields.YEAR: {"source": "test_source.bib/TestAttentionRecord2025", "note": ""},
                Fields.JOURNAL: {"source": "test_source.bib/TestAttentionRecord2025", "note": ""},
            },
            Fields.D_PROV: {},
        }

        imported_record = {
            Fields.ID: "TestImportedRecord2025",
            Fields.ENTRYTYPE: "article",
            Fields.STATUS: RecordState.md_imported,
            Fields.TITLE: "Some Imported Article Title",
            Fields.AUTHOR: "Doe, Jane",
            Fields.YEAR: "2024",
            Fields.JOURNAL: "Another Journal",
            Fields.ORIGIN: ["test_source.bib/TestImportedRecord2025"],
            Fields.MD_PROV: {
                Fields.TITLE: {"source": "test_source.bib/TestImportedRecord2025", "note": ""},
                Fields.AUTHOR: {"source": "test_source.bib/TestImportedRecord2025", "note": ""},
                Fields.YEAR: {"source": "test_source.bib/TestImportedRecord2025", "note": ""},
                Fields.JOURNAL: {"source": "test_source.bib/TestImportedRecord2025", "note": ""},
            },
            Fields.D_PROV: {},
        }

        records_dict = {
            attention_record[Fields.ID]: attention_record,
            imported_record[Fields.ID]: imported_record,
        }

        rm.dataset.save_records_dict(records_dict)
        rm.create_commit(msg="Add test records for prep_man tests")

        return attention_record[Fields.ID], imported_record[Fields.ID]
    finally:
        os.chdir(original_cwd)


class TestPrepManUpdateRecordEndpoint:
    """Tests for the prep_man_update_record endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self, tmp_path, mocker):
        """Set up a test project with records for manual preparation testing."""
        self.base_path = tmp_path
        self.project_id = "prep_man_test_project"
        self.test_dir = self.base_path / self.project_id
        self.test_dir.mkdir()

        mocker.patch(
            "colrev.env.environment_manager.EnvironmentManager.get_name_mail_from_git",
            return_value=("Test User", "test@example.com"),
        )

        mocker.patch.object(
            colrev.constants.Filepaths,
            "REGISTRY_FILE",
            self.test_dir / "reg.json",
        )

        original_cwd = os.getcwd()
        os.chdir(self.test_dir)
        try:
            colrev.ops.init.Initializer(
                review_type="literature_review",
                target_path=self.test_dir,
                light=True,
                example=False,
            )
        finally:
            os.chdir(original_cwd)

        # Create test records directly
        self.attention_record_id, self.imported_record_id = _create_test_records(
            self.test_dir
        )

        self.handler = JSONRPCHandler()

    def test_update_fixes_all_defects_transitions_to_md_prepared(self):
        """Test that fixing all defects transitions record to md_prepared."""
        request = {
            "jsonrpc": "2.0",
            "method": "prep_man_update_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_id": self.attention_record_id,
                "fields": {"title": "A Proper Title for This Record"},
                "skip_commit": True,
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        result = response["result"]
        assert result["success"] is True
        assert result["details"]["new_status"] == "md_prepared"

    def test_update_partial_fix_stays_needs_manual(self):
        """Test that partial fix keeps record in md_needs_manual_preparation."""
        # Set up the record with multiple defects: missing title AND missing journal
        original_cwd = os.getcwd()
        project_path = self.base_path / self.project_id
        os.chdir(project_path)
        try:
            rm = colrev.review_manager.ReviewManager(
                path_str=str(project_path),
                force_mode=True,
            )
            rm.get_status_operation()
            records_dict = rm.dataset.load_records_dict()
            record = records_dict[self.attention_record_id]
            # Both title and journal are UNKNOWN for an article entry type
            record[Fields.TITLE] = FieldValues.UNKNOWN
            record[Fields.JOURNAL] = FieldValues.UNKNOWN
            if Fields.BOOKTITLE in record:
                del record[Fields.BOOKTITLE]
            record[Fields.MD_PROV] = {
                Fields.TITLE: {"source": "test", "note": "missing"},
                Fields.AUTHOR: {"source": "test", "note": ""},
                Fields.YEAR: {"source": "test", "note": ""},
                Fields.JOURNAL: {"source": "test", "note": "missing"},
            }
            rm.dataset.save_records_dict(records_dict)
            rm.create_commit(msg="Set up multi-defect record")
        finally:
            os.chdir(original_cwd)

        # Fix only title but not journal
        request = {
            "jsonrpc": "2.0",
            "method": "prep_man_update_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_id": self.attention_record_id,
                "fields": {"title": "Fixed Title"},
                "skip_commit": True,
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)

        assert "error" not in response, f"Unexpected error: {response.get('error')}"
        result = response["result"]
        assert result["success"] is True
        assert result["details"]["new_status"] == "md_needs_manual_preparation"
        assert "remaining_defects" in result["details"]

    def test_update_wrong_status_returns_error(self):
        """Test that updating a record not in md_needs_manual_preparation returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "prep_man_update_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_id": self.imported_record_id,
                "fields": {"title": "New Title"},
                "skip_commit": True,
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" in response
        assert "md_needs_manual_preparation" in response["error"]["message"]

    def test_update_protected_field_returns_error(self):
        """Test that updating protected fields returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "prep_man_update_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_id": self.attention_record_id,
                "fields": {"ID": "new_id"},
                "skip_commit": True,
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" in response
        assert "protected" in response["error"]["message"].lower()

    def test_update_missing_record_id_returns_error(self):
        """Test that missing record_id parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "prep_man_update_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "fields": {"title": "New Title"},
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" in response
        assert "record_id" in response["error"]["message"].lower()

    def test_update_missing_fields_returns_error(self):
        """Test that missing fields parameter returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "prep_man_update_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_id": self.attention_record_id,
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" in response
        assert "fields" in response["error"]["message"].lower()

    def test_update_nonexistent_record_returns_error(self):
        """Test that non-existent record ID returns error."""
        request = {
            "jsonrpc": "2.0",
            "method": "prep_man_update_record",
            "params": {
                "project_id": self.project_id,
                "base_path": str(self.base_path),
                "record_id": "nonexistent_record_xyz",
                "fields": {"title": "New Title"},
                "skip_commit": True,
            },
            "id": 1,
        }

        response = self.handler.handle_request(request)
        assert "error" in response
        assert "not found" in response["error"]["message"].lower()
