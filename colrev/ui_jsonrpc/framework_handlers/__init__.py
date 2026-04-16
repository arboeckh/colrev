"""Framework-native JSON-RPC handlers.

Each submodule defines a handler class that inherits from
``colrev.ui_jsonrpc.framework.BaseHandler`` and decorates methods with
``@rpc_method``. Importing this package is sufficient to register every
contained method in the global dispatcher registry.

Phase B ships the framework with no migrated methods yet. Phase C pilot
adds ``ping`` and ``prescreen_record``; Phase C sweep adds the rest.
"""

# Phase B/C pilot: system (ping) + prescreen_record.
# Phase C sweep appends the remaining handler modules here.
from colrev.ui_jsonrpc.framework_handlers import data_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import dedupe_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import git_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import init_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import load_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import managed_review_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import pdf_get_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import pdf_prep_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import pdf_share_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import prep_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import prep_man_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import prescreen_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import records_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import review_definition_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import screen_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import search_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import settings_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import status_handler  # noqa: F401
from colrev.ui_jsonrpc.framework_handlers import system_handler  # noqa: F401
