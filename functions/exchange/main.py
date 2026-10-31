"""Exchange a verified ORCID ID token for a Firebase custom token (docs/team-workspaces.md).

The browser already signs in with ORCID (OpenID Connect). This function checks
that ID token on the server, where it cannot be faked, and returns a Firebase
custom token whose uid is the ORCID iD. Firestore rules then grant access only
through memberships keyed by that iD. Nothing is stored here.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Callable

import functions_framework
import jwt

ISSUER = "https://orcid.org"
JWKS_URL = "https://orcid.org/oauth/jwks"
ORCID_ID = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")
# ORCID ID tokens live 10 minutes; allow for a little clock drift.
LEEWAY_SECONDS = 60
MAX_BODY = 8192
DEFAULT_ORIGINS = ("https://orcid-playground-889.web.app", "https://orcid-playground-889.firebaseapp.com")
PREVIEW_ORIGIN = re.compile(r"^https://orcid-playground-889--[a-z0-9-]+\.web\.app$")

_jwks: jwt.PyJWKClient | None = None


class Refused(Exception):
    """The request cannot be honoured; the message is safe to return."""


def allowed_origin(origin: str | None) -> bool:
    extra = tuple(o for o in os.environ.get("EXTRA_ORIGINS", "").split(",") if o)
    return bool(origin) and (origin in DEFAULT_ORIGINS + extra or bool(PREVIEW_ORIGIN.match(origin)))


def signing_key(token: str):
    global _jwks
    _jwks = _jwks or jwt.PyJWKClient(JWKS_URL, cache_keys=True, lifespan=3600)
    return _jwks.get_signing_key_from_jwt(token).key


def verify_orcid_token(token: str, client_id: str, key_for: Callable[[str], Any] = signing_key) -> dict[str, Any]:
    """Return the claims of a valid ORCID ID token issued to our client, or raise Refused."""
    if not isinstance(token, str) or token.count(".") != 2 or len(token) > 6000:
        raise Refused("A signed ORCID ID token is required.")
    try:
        claims = jwt.decode(token, key_for(token), algorithms=["RS256"], audience=client_id, issuer=ISSUER,
                            leeway=LEEWAY_SECONDS, options={"require": ["exp", "iat", "iss", "aud", "sub"]})
    except (jwt.PyJWTError, ValueError) as error:
        raise Refused("The ORCID sign-in could not be verified.") from error
    if not ORCID_ID.match(str(claims.get("sub", ""))):
        raise Refused("The ORCID sign-in did not carry an ORCID iD.")
    return claims


def mint_custom_token(orcid: str) -> str:
    import firebase_admin
    from firebase_admin import auth
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return auth.create_custom_token(orcid).decode("ascii")


def handle(method: str, origin: str | None, body: bytes, client_id: str,
           key_for: Callable[[str], Any] = signing_key, mint: Callable[[str], str] = mint_custom_token):
    """Pure request handling, returning (status, payload, headers); kept separate for tests."""
    headers = {"Vary": "Origin", "Cache-Control": "no-store", "Content-Type": "application/json"}
    if allowed_origin(origin):
        headers.update({"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST",
                        "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "3600"})
    if method == "OPTIONS":
        return (204 if allowed_origin(origin) else 403), None, headers
    if not allowed_origin(origin):
        return 403, {"error": "This origin may not exchange ORCID sign-ins."}, headers
    if method != "POST":
        return 405, {"error": "Use POST."}, headers
    if not client_id:
        return 503, {"error": "ORCID sign-in is not configured."}, headers
    try:
        if len(body) > MAX_BODY:
            raise Refused("Request too large.")
        try:
            payload = json.loads(body or b"{}")
        except json.JSONDecodeError as error:
            raise Refused("Send a JSON object.") from error
        if not isinstance(payload, dict):
            raise Refused("Send a JSON object.")
        claims = verify_orcid_token(payload.get("id_token"), client_id, key_for)
    except Refused as error:
        return 401, {"error": str(error)}, headers
    name = " ".join(str(claims.get(k) or "") for k in ("given_name", "family_name")).strip() or None
    return 200, {"custom_token": mint(claims["sub"]), "orcid": claims["sub"], "name": name}, headers


@functions_framework.http
def exchange(request):
    status, payload, headers = handle(request.method, request.headers.get("Origin"),
                                      request.get_data(cache=False, as_text=False)[: MAX_BODY + 1],
                                      os.environ.get("ORCID_CLIENT_ID", ""))
    return (json.dumps(payload) if payload is not None else "", status, headers)
