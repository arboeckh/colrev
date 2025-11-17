"""Operation handlers for JSON-RPC requests."""

from colrev.ui_jsonrpc.handlers.data_handler import DataHandler
from colrev.ui_jsonrpc.handlers.dedupe_handler import DedupeHandler
from colrev.ui_jsonrpc.handlers.init_handler import InitHandler
from colrev.ui_jsonrpc.handlers.load_handler import LoadHandler
from colrev.ui_jsonrpc.handlers.pdf_get_handler import PDFGetHandler
from colrev.ui_jsonrpc.handlers.pdf_prep_handler import PDFPrepHandler
from colrev.ui_jsonrpc.handlers.prep_handler import PrepHandler
from colrev.ui_jsonrpc.handlers.prescreen_handler import PrescreenHandler
from colrev.ui_jsonrpc.handlers.screen_handler import ScreenHandler
from colrev.ui_jsonrpc.handlers.search_handler import SearchHandler
from colrev.ui_jsonrpc.handlers.status_handler import StatusHandler

__all__ = [
    "DataHandler",
    "DedupeHandler",
    "InitHandler",
    "LoadHandler",
    "PDFGetHandler",
    "PDFPrepHandler",
    "PrepHandler",
    "PrescreenHandler",
    "ScreenHandler",
    "SearchHandler",
    "StatusHandler",
]
