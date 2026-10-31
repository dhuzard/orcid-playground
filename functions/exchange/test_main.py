import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

import main

CLIENT = "APP-TESTCLIENT0000000"
ORIGIN = "https://orcid-playground-889.web.app"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def token(key=KEY, alg="RS256", **overrides):
    now = int(time.time())
    claims = {"iss": main.ISSUER, "aud": CLIENT, "sub": "0000-0002-1825-0097", "iat": now, "exp": now + 600,
              "given_name": "Josiah", "family_name": "Carberry", "nonce": "n"}
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key, algorithm=alg, headers={"kid": "k1"})


def call(id_token, origin=ORIGIN, method="POST", client_id=CLIENT, body=None):
    raw = body if body is not None else json.dumps({"id_token": id_token}).encode()
    return main.handle(method, origin, raw, client_id, key_for=lambda t: KEY.public_key(), mint=lambda uid: f"custom:{uid}")


def test_valid_orcid_token_becomes_a_custom_token_keyed_by_the_orcid_id():
    status, payload, headers = call(token())
    assert status == 200
    assert payload == {"custom_token": "custom:0000-0002-1825-0097", "orcid": "0000-0002-1825-0097", "name": "Josiah Carberry"}
    assert headers["Access-Control-Allow-Origin"] == ORIGIN and headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("bad", [
    {"key": OTHER_KEY},                                   # forged signature
    {"aud": "APP-SOMEONEELSE00000"},                      # issued to another client
    {"iss": "https://evil.example"},                      # another issuer
    {"exp": int(time.time()) - 3600},                     # expired
    {"exp": None},                                        # no expiry
    {"sub": "not-an-orcid"},                              # not an ORCID iD
    {"alg": "HS256", "key": "shared-secret-of-32-bytes-at-least!!"},  # algorithm confusion
])
def test_untrustworthy_tokens_are_refused(bad):
    bad = dict(bad)
    status, payload, _ = call(token(**bad))
    assert status == 401 and "custom_token" not in payload


def test_malformed_requests_are_refused_without_minting():
    minted = []
    for body in (b"not json", b"[1]", b"{}", json.dumps({"id_token": "a.b"}).encode(), b"x" * (main.MAX_BODY + 1)):
        status, payload, _ = main.handle("POST", ORIGIN, body, CLIENT, key_for=lambda t: KEY.public_key(), mint=minted.append)
        assert status == 401, body[:20]
    assert minted == []


def test_only_the_playground_origins_may_call_it():
    assert call(token(), origin="https://evil.example")[0] == 403
    assert call(token(), origin=None)[0] == 403
    assert call(token(), origin="https://orcid-playground-889--preview-abc123.web.app")[0] == 200
    assert call(token(), origin="https://orcid-playground-889--x.web.app.evil.example")[0] == 403


def test_preflight_method_and_configuration():
    assert call(None, method="OPTIONS")[0] == 204
    assert call(None, method="OPTIONS", origin="https://evil.example")[0] == 403
    assert call(token(), method="GET")[0] == 405
    assert call(token(), client_id="")[0] == 503
