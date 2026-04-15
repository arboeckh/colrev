"""Per-endpoint builders that turn a user's `search_string` into the
`search_parameters` dict that each colrev API search package expects.

Shapes mirror what each package's own `add_endpoint` would produce when called
with an empty params dict — see the `search_parameters = {...}` assignments in:
  - colrev/packages/pubmed/src/*  (not in this file: PubMed URL shape)
  - colrev/packages/crossref/src/crossref_search_source.py
  - colrev/packages/arxiv/src/arxiv.py
  - colrev/packages/dblp/src/dblp.py
  - colrev/packages/eric/src/eric.py
  - colrev/packages/plos/src/plos_search_source.py

Each builder receives the raw user query and returns the dict to set as
`new_source.search_parameters`. Endpoints not listed here fall through to no
parameter mutation (the package's own logic decides what to do, if anything).
"""

from __future__ import annotations

import urllib.parse
from typing import Callable, Dict


def _pubmed(query: str) -> Dict[str, str]:
    encoded = urllib.parse.quote(query)
    return {
        "url": (
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
            f"?db=pubmed&term={encoded}"
        )
    }


def _crossref(query: str) -> Dict[str, str]:
    return {
        "url": (
            "https://api.crossref.org/works?query.bibliographic="
            + query.replace(" ", "+")
        )
    }


def _arxiv(query: str) -> Dict[str, str]:
    return {"query": query}


def _dblp(query: str) -> Dict[str, str]:
    return {"query": "https://dblp.org/search/publ/api?q=" + query}


def _eric(query: str) -> Dict[str, str]:
    return {"query": query}


def _plos(query: str) -> Dict[str, str]:
    fl = (
        "id,abstract,author_display,title_display,"
        "journal,publication_date,volume,issue"
    )
    return {
        "url": (
            "http://api.plos.org/search?q="
            + query.replace(" ", "+")
            + f"&fl={fl}"
        )
    }


API_PARAM_BUILDERS: Dict[str, Callable[[str], Dict[str, str]]] = {
    "colrev.pubmed": _pubmed,
    "colrev.crossref": _crossref,
    "colrev.arxiv": _arxiv,
    "colrev.dblp": _dblp,
    "colrev.eric": _eric,
    "colrev.plos": _plos,
}


def build_api_params(endpoint: str, query: str) -> Dict[str, str] | None:
    """Return search_parameters for a known API endpoint, or None if unknown."""
    builder = API_PARAM_BUILDERS.get(endpoint)
    if builder is None:
        return None
    return builder(query)
