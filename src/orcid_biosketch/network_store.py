"""Transactional, local-only research network workspace (no ORCID polling)."""

from __future__ import annotations

import csv
import calendar
import hashlib
import io
import json
import re
import sqlite3
import uuid
import zipfile
from contextlib import closing, contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from .core import OrcidError, normalize_orcid, render_markdown
from .exporters import to_bibtex, to_ris


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(value: Any) -> str:
    return str(value or "").strip()


def _doi(work: dict) -> str:
    value = next((_text(v) for k, v in work.get("identifiers", {}).items()
                  if k.lower() == "doi"), "")
    return re.sub(r"^(?:(?:https?://)?(?:dx\.)?doi\.org/|doi:\s*)", "", value,
                  flags=re.IGNORECASE).strip().lower()


def _work_key(person_id: str, work: dict, demo: bool = False) -> str:
    if demo:
        return "demo-work:" + _text(work["orcid_put_code"])
    if _doi(work):
        return "doi:" + _doi(work)
    if work.get("orcid_put_code") is not None:
        return f"orcid:{person_id}:{work['orcid_put_code']}"
    identity = [_text(work.get(k)).casefold() for k in ("title", "type", "publication_date")]
    return f"work:{person_id}:" + hashlib.sha256(json.dumps(identity).encode()).hexdigest()[:24]


def _csv_cell(value: str) -> str:
    # A roster can contain public, untrusted profile text; prevent spreadsheet formulas.
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value


def _bounded_text(value: Any, field: str, limit: int, *, required: bool = False) -> str:
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise ValueError(f"{field} must contain {'1–' if required else 'at most '}{limit} characters")
    return value.strip()


def _date_bound(value: Any, field: str) -> date | None:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be empty or a date in YYYY-MM-DD format")
    if not value:
        return None
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError()
        return date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"{field} must be empty or a real date in YYYY-MM-DD format") from error


def _publication_interval(value: str) -> tuple[date, date] | None:
    """A partial publication date denotes its full calendar year or month."""
    try:
        if re.fullmatch(r"\d{4}", value):
            year = int(value)
            return date(year, 1, 1), date(year, 12, 31)
        if re.fullmatch(r"\d{4}-\d{2}", value):
            year, month = map(int, value.split("-"))
            return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            day = date.fromisoformat(value)
            return day, day
    except ValueError:
        pass
    return None


class NetworkStore:
    """One SQLite file; each mutation is a durable all-or-nothing transaction.

    Connections are short-lived, so independent server threads and store instances
    share SQLite's process-safe locking. Stored biosketches preserve provenance.
    """

    def __init__(self, path: str | Path):
        self.path = Path(path).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(str(self.path), timeout=30)) as connection:
            with connection:
                connection.execute("CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)")
                connection.execute("INSERT OR IGNORE INTO workspace VALUES (1, ?)",
                                   (json.dumps({"version": 1, "profiles": {}, "events": {},
                                                "saved": [], "groups": {}}),))

    @contextmanager
    def _transaction(self, write: bool = False):
        connection = sqlite3.connect(str(self.path), timeout=30)
        try:
            connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            data = json.loads(connection.execute("SELECT data FROM workspace WHERE id=1").fetchone()[0])
            if data.get("version") != 1:
                raise ValueError("Unsupported network workspace version")
            for group in data["groups"].values():
                self._group_defaults(group)
            yield data
            if write:
                connection.execute("UPDATE workspace SET data=? WHERE id=1",
                                   (json.dumps(data, ensure_ascii=False, allow_nan=False),))
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @staticmethod
    def _works(data: dict) -> dict:
        works: dict[str, dict] = {}
        for person_id, profile in data["profiles"].items():
            for work in profile["bio"]["works"]:
                key = _work_key(person_id, work, profile["demo"])
                if key not in works:
                    works[key] = {"id": key, "title": _text(work.get("title")),
                                  "type": _text(work.get("type")), "date": _text(work.get("publication_date")),
                                  "doi": _doi(work), "url": _text(work.get("url")),
                                  "people_ids": [], "saved": key in data["saved"],
                                  "demo": profile["demo"], "_source": work}
                if person_id not in works[key]["people_ids"]:
                    works[key]["people_ids"].append(person_id)
        return works

    @classmethod
    def _prune(cls, data: dict) -> None:
        works = cls._works(data)
        data["saved"] = [key for key in data["saved"] if key in works]
        events = {}
        for key, event in data["events"].items():
            if key not in works:
                continue
            event["people_ids"] = [person_id for person_id in event.get("people_ids", [])
                                   if person_id in works[key]["people_ids"]]
            if event["people_ids"]:
                events[key] = event
        data["events"] = events
        for group in data["groups"].values():
            cls._group_defaults(group)
            members = set(group["member_ids"])
            group["member_details"] = {key: details for key, details in group["member_details"].items()
                                       if key in members}
            group["selected_work_ids"] = [key for key in group["selected_work_ids"]
                                           if key in works and members.intersection(works[key]["people_ids"])]
            for request in group["requests"]:
                if request["owner_id"] not in members:
                    request["owner_id"] = None

    @staticmethod
    def _group_defaults(group: dict) -> None:
        group.setdefault("member_details", {})
        group.setdefault("selected_work_ids", [])
        group.setdefault("requests", [])

    @staticmethod
    def _group(data: dict, id: str) -> dict:
        if not isinstance(id, str) or id not in data["groups"]:
            raise ValueError("Unknown group")
        return data["groups"][id]

    def state(self) -> dict:
        with self._transaction() as data:
            works = self._works(data)
            people = []
            for person_id, profile in data["profiles"].items():
                bio = profile["bio"]
                person = bio["person"]
                employment = next((e for e in bio["employment"] if not e.get("end_date")),
                                  next(iter(bio["employment"]), {}))
                people.append({"id": person_id, "name": person["name"] or person_id,
                               "orcid": None if profile["demo"] else person_id,
                               "headline": _text(employment.get("role")),
                               "affiliation": _text(employment.get("organization")),
                               "keywords": person["keywords"], "demo": profile["demo"],
                               "following": profile["following"], "last_checked": profile["last_checked"],
                               "work_count": sum(person_id in w["people_ids"] for w in works.values())})
            events = []
            for key, event in data["events"].items():
                if key not in works:
                    continue
                # Early pilot files without observation provenance fail closed:
                # do not assign an old observation to every current researcher.
                observed_people = [person_id for person_id in event.get("people_ids", [])
                                   if person_id in works[key]["people_ids"]]
                if observed_people:
                    events.append({"id": "event:" + key, "work_id": key, "kind": "work-added",
                                   "observed_at": event["observed_at"], "people_ids": observed_people,
                                   "demo": works[key]["demo"]})
            public_works = [{k: v for k, v in work.items() if k != "_source"} for work in works.values()]
            return {"people": people, "works": sorted(public_works, key=lambda w: w["date"], reverse=True),
                    "events": sorted(events, key=lambda e: e["observed_at"], reverse=True),
                    "groups": list(data["groups"].values())}

    @staticmethod
    def _validate_bio(bio: Any) -> tuple[str, dict]:
        if not isinstance(bio, dict) or not isinstance(bio.get("person"), dict):
            raise ValueError("A normalized biosketch with a person is required")
        try:
            person_id = normalize_orcid(bio["person"].get("orcid"))
            result = json.loads(json.dumps(bio, allow_nan=False))
        except (OrcidError, TypeError, AttributeError, ValueError) as error:
            raise ValueError("A valid ORCID biosketch is required") from error
        for section in ("works", "employment"):
            if not isinstance(result.get(section, []), list) or any(not isinstance(x, dict) for x in result.get(section, [])):
                raise ValueError(f"Biosketch {section} must be a list of objects")
            result.setdefault(section, [])
        person = result["person"]
        person.update(orcid=person_id, orcid_url=f"https://orcid.org/{person_id}")
        person["name"] = _text(person.get("credit_name") or person.get("name"))
        person["biography"] = _text(person.get("biography"))
        if not isinstance(person.get("keywords", []), list):
            raise ValueError("Keywords must be a list")
        person["keywords"] = [_text(keyword) for keyword in person.get("keywords", []) if keyword]
        for affiliation in result["employment"]:
            for field in ("role", "organization", "start_date", "end_date"):
                affiliation[field] = _text(affiliation.get(field))
        for work in result["works"]:
            if not isinstance(work.get("identifiers", {}), dict):
                raise ValueError("Work identifiers must be an object")
            work.setdefault("identifiers", {})
            for field in ("title", "type", "publication_date", "url"):
                work[field] = _text(work.get(field))
        if not isinstance(result.get("provenance", {}), dict):
            raise ValueError("Biosketch provenance must be an object")
        result.setdefault("provenance", {}).setdefault("generated_at", None)
        return person_id, result

    def import_biosketch(self, bio: dict) -> None:
        person_id, bio = self._validate_bio(bio)
        with self._transaction(True) as data:
            previous = data["profiles"].get(person_id)
            old_works = previous["bio"]["works"] if previous else []
            old_keys = {_work_key(person_id, work) for work in old_works}
            old_codes = {_text(work["orcid_put_code"]): _work_key(person_id, work)
                         for work in old_works if work.get("orcid_put_code") is not None}
            now = _now()
            for work in bio["works"]:
                key = _work_key(person_id, work)
                prior_key = old_codes.get(_text(work.get("orcid_put_code")))
                if prior_key and prior_key != key:
                    # Adding/changing a DOI is metadata maintenance, not a new work.
                    if prior_key in data["saved"] and key not in data["saved"]:
                        data["saved"].append(key)
                    for group in data["groups"].values():
                        if (person_id in group["member_ids"] and prior_key in group["selected_work_ids"]
                                and key not in group["selected_work_ids"]):
                            group["selected_work_ids"].append(key)
                    if prior_key in data["events"]:
                        prior_event = data["events"][prior_key]
                        if person_id in prior_event.get("people_ids", []):
                            event = data["events"].setdefault(key, {"observed_at": prior_event["observed_at"], "people_ids": []})
                            if person_id not in event.setdefault("people_ids", []):
                                event["people_ids"].append(person_id)
                if previous and key not in old_keys and not prior_key:
                    event = data["events"].setdefault(key, {"observed_at": now, "people_ids": []})
                    if person_id not in event.setdefault("people_ids", []):
                        event["people_ids"].append(person_id)
            data["profiles"][person_id] = {"bio": bio, "following": previous["following"] if previous else True,
                                           "last_checked": now, "demo": False}
            self._prune(data)

    def follow(self, id: str, following: bool) -> None:
        if not isinstance(id, str) or not isinstance(following, bool):
            raise ValueError("A person id and boolean following value are required")
        with self._transaction(True) as data:
            if id not in data["profiles"]:
                raise ValueError("Unknown researcher")
            data["profiles"][id]["following"] = following

    def save(self, id: str, saved: bool) -> None:
        if not isinstance(id, str) or not isinstance(saved, bool):
            raise ValueError("A work id and boolean saved value are required")
        with self._transaction(True) as data:
            if id not in self._works(data):
                raise ValueError("Unknown work")
            if saved and id not in data["saved"]:
                data["saved"].append(id)
            elif not saved and id in data["saved"]:
                data["saved"].remove(id)

    @staticmethod
    def _group_values(data: dict, name: str, description: str, member_ids: list) -> dict:
        if not isinstance(name, str) or not name.strip() or len(name) > 120:
            raise ValueError("Group name must contain 1–120 characters")
        if not isinstance(description, str) or len(description) > 2000:
            raise ValueError("Group description must contain at most 2000 characters")
        if not isinstance(member_ids, list) or any(not isinstance(x, str) or x not in data["profiles"] for x in member_ids):
            raise ValueError("Group members must be imported researchers")
        return {"name": name.strip(), "description": description.strip(), "member_ids": list(dict.fromkeys(member_ids))}

    def create_group(self, name: str, description: str, member_ids: list) -> str:
        with self._transaction(True) as data:
            values = self._group_values(data, name, description, member_ids)
            group_id = str(uuid.uuid4())
            data["groups"][group_id] = {"id": group_id, **values, "created_at": _now()}
            self._group_defaults(data["groups"][group_id])
            return group_id

    def update_group(self, id: str, name: str, description: str, member_ids: list) -> None:
        with self._transaction(True) as data:
            self._group(data, id).update(self._group_values(data, name, description, member_ids))
            self._prune(data)

    def add_group_members(self, id: str, member_ids: list) -> None:
        with self._transaction(True) as data:
            group = self._group(data, id)
            values = self._group_values(data, group["name"], group["description"], member_ids)
            group["member_ids"] = list(dict.fromkeys(group["member_ids"] + values["member_ids"]))

    def set_group_member(self, id: str, person_id: str, role: str, expertise: str, contribution: str) -> None:
        details = {"role": _bounded_text(role, "Role", 120),
                   "expertise": _bounded_text(expertise, "Expertise", 500),
                   "contribution": _bounded_text(contribution, "Contribution", 1000)}
        with self._transaction(True) as data:
            group = self._group(data, id)
            if not isinstance(person_id, str) or person_id not in group["member_ids"]:
                raise ValueError("Member details require a current group member")
            group["member_details"][person_id] = details

    def select_group_work(self, id: str, work_id: str, selected: bool) -> None:
        if not isinstance(work_id, str) or not isinstance(selected, bool):
            raise ValueError("A work id and boolean selected value are required")
        with self._transaction(True) as data:
            group = self._group(data, id)
            work = self._works(data).get(work_id)
            if not work or not set(group["member_ids"]).intersection(work["people_ids"]):
                raise ValueError("Project outputs must belong to a current group member")
            if selected and work_id not in group["selected_work_ids"]:
                group["selected_work_ids"].append(work_id)
            elif not selected and work_id in group["selected_work_ids"]:
                group["selected_work_ids"].remove(work_id)

    def create_group_request(self, id: str, title: str, description: str,
                             owner_id: str | None = None, due_date: str = "") -> None:
        title = _bounded_text(title, "Request title", 160, required=True)
        description = _bounded_text(description, "Request description", 2000)
        _date_bound(due_date, "Due date")
        with self._transaction(True) as data:
            group = self._group(data, id)
            if owner_id is not None and (not isinstance(owner_id, str) or owner_id not in group["member_ids"]):
                raise ValueError("Request owner must be a current group member")
            group["requests"].append({"id": str(uuid.uuid4()), "title": title, "description": description,
                                       "owner_id": owner_id, "due_date": due_date,
                                       "status": "open", "created_at": _now()})

    def set_group_request_status(self, id: str, request_id: str, status: str) -> None:
        if not isinstance(status, str) or status not in ("open", "resolved"):
            raise ValueError("Request status must be open or resolved")
        with self._transaction(True) as data:
            group = self._group(data, id)
            request = next((item for item in group["requests"] if item["id"] == request_id), None)
            if not isinstance(request_id, str) or request is None:
                raise ValueError("Unknown group request")
            request["status"] = status

    def export_group(self, id: str, *, scope: str = "members", date_from: str = "",
                     date_to: str = "", member_ids: list | None = None) -> bytes:
        if not isinstance(scope, str) or scope not in ("members", "project"):
            raise ValueError("Export scope must be members or project")
        start = _date_bound(date_from, "Start date")
        end = _date_bound(date_to, "End date")
        if start and end and start > end:
            raise ValueError("Start date must not be after end date")

        def in_window(work: dict) -> bool:
            if not start and not end:
                return True
            interval = _publication_interval(work["publication_date"])
            return bool(interval and (not start or interval[1] >= start) and (not end or interval[0] <= end))

        with self._transaction() as data:
            group = self._group(data, id)
            if member_ids is None:
                members = group["member_ids"]
            else:
                if (not isinstance(member_ids, list) or not member_ids
                        or any(not isinstance(person_id, str) or person_id not in group["member_ids"]
                               for person_id in member_ids)):
                    raise ValueError("Export members must be a nonempty list of current group members")
                members = list(dict.fromkeys(member_ids))
            profiles = {}
            for person_id in members:
                profile = data["profiles"][person_id]
                works = [work for work in profile["bio"]["works"]
                         if (scope == "members" or _work_key(person_id, work, profile["demo"]) in group["selected_work_ids"])
                         and in_window(work)]
                profiles[person_id] = {**profile, "bio": {**profile["bio"], "works": works}}
            group_data = {**data, "profiles": profiles}
            exported_works = self._works(group_data)
            selected = [w["_source"] for w in exported_works.values()]
            exported_group = {
                **group, "member_ids": members,
                "member_details": {person_id: details for person_id, details in group["member_details"].items()
                                   if person_id in members},
                "selected_work_ids": [key for key in group["selected_work_ids"] if key in exported_works],
                "requests": [request for request in group["requests"]
                             if request["owner_id"] is None or request["owner_id"] in members],
            }
            roster = io.StringIO(newline="")
            writer = csv.writer(roster)
            writer.writerow(["name", "orcid", "profile_id", "demo", "membership", "role", "expertise", "contribution"])
            manifest = {
                "group_id": id, "group_name": group["name"], "generated_at": _now(),
                "scope": scope, "date_from": date_from, "date_to": date_to, "member_ids": members,
                "work_ids": list(exported_works), "work_count": len(selected),
                "membership": "locally curated; unconfirmed",
                "attribution": ("Locally selected project outputs; attribution is unconfirmed by members."
                                if scope == "project" else "Member publications; project attribution is not asserted."),
                "date_filter_policy": "Partial dates use calendar interval overlap; unknown or invalid publication dates are excluded when date bounds are set.",
                "biosketch_scope": "Each biosketch includes only that member's works matching the selected scope and date window.",
                "group_metadata_policy": "Group metadata includes only exported members, their details and exported project selections. Requests are included only when unassigned or owned by an exported member; publication-date filters do not filter requests.",
                "source": "Public ORCID records at last manual import, or explicitly marked fictional demo data.",
            }
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                for person_id in members:
                    profile = profiles[person_id]
                    bio = profile["bio"]
                    details = group["member_details"].get(person_id, {})
                    writer.writerow([_csv_cell(bio["person"]["name"]), "" if profile["demo"] else person_id,
                                     person_id, str(profile["demo"]).lower(), "locally curated; unconfirmed",
                                     *[_csv_cell(details.get(field, "")) for field in ("role", "expertise", "contribution")]])
                    markdown = render_markdown(bio, max_works=len(bio["works"]))
                    if profile["demo"]:
                        markdown = "**Fictional demonstration profile — not an ORCID record.**\n\n" + markdown
                        markdown = markdown.replace("[ORCID: ]()\n", "").replace("_Generated from ORCID; synchronized None._", "_Fictional demonstration data._")
                    archive.writestr(f"biosketches/{person_id}.md", markdown)
                    archive.writestr(f"biosketches/{person_id}.json", json.dumps(bio, ensure_ascii=False, indent=2))
                archive.writestr("roster.csv", "\ufeff" + roster.getvalue())
                archive.writestr("bibliography.bib", to_bibtex({"works": selected}))
                archive.writestr("bibliography.ris", to_ris({"works": selected}))
                archive.writestr("group.json", json.dumps(exported_group, ensure_ascii=False, indent=2))
                archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
                archive.writestr("README.txt", f"{group['name']} — local pilot team pack\n\n"
                                 "Membership is locally curated and unconfirmed. Member publications are not automatically project outputs.\n"
                                 "Records reflect their last manual import; this is not a live ORCID record.\n"
                                 "Citation metadata can be incomplete: summary records may omit authors or venues. Missing contributors are not inferred.\n"
                                 "Role, expertise, contribution and project selections are local, unconfirmed entries.\n"
                                 "See manifest.json for export scope, members and publication-date filters. Biosketch works obey these filters.\n"
                                 "Partial dates use calendar interval overlap; unknown or invalid dates are excluded when date bounds are set.\n"
                                 "Profiles with demo=true and titles marked [Demo] are fictional demonstration data.\n")
            return output.getvalue()

    def add_demo(self) -> None:
        """Insert clearly fictional content once; never reset user edits or follows."""
        with self._transaction(True) as data:
            now = _now()
            examples = [
                ("demo-ada", "Ada Rivera", "Open methods", ["reproducibility", "open science"], ["shared", "software"]),
                ("demo-sam", "Sam Okafor", "Research data", ["datasets", "collaboration"], ["shared", "dataset"]),
                ("demo-lin", "Lin Moreau", "Scientific collaboration", ["networks", "open science"], ["dataset"]),
            ]
            library = {
                "shared": ("[Demo] A practical guide to open research teams", "journal-article", "2026-09-15"),
                "software": ("[Demo] Small tools for reproducible experiments", "software", "2026-10-01"),
                "dataset": ("[Demo] A shared atlas of research methods", "data-set", "2026-10-08"),
            }
            for person_id, name, role, keywords, work_ids in examples:
                if person_id in data["profiles"]:
                    continue
                bio = {"schema_version": "0.2.0", "demo": True,
                       "person": {"name": name, "orcid": "", "orcid_url": "", "biography": "Fictional demonstration researcher.", "keywords": keywords},
                       "employment": [{"role": role, "organization": "Demo Research Collective (fictional)", "start_date": "", "end_date": ""}],
                       "works": [{"title": library[k][0], "type": library[k][1], "publication_date": library[k][2],
                                  "identifiers": {}, "url": "", "orcid_put_code": k, "demo": True} for k in work_ids],
                       "provenance": {"generated_at": None, "primary_source": "fictional demo"}}
                data["profiles"][person_id] = {"bio": bio, "following": True, "last_checked": now, "demo": True}
                for work in bio["works"]:
                    event = data["events"].setdefault(_work_key(person_id, work, True), {"observed_at": now, "people_ids": []})
                    if person_id not in event.setdefault("people_ids", []):
                        event["people_ids"].append(person_id)
            data["groups"].setdefault("demo-open-science", {
                "id": "demo-open-science", "name": "Open Science Circle · Demo", "description": "A fictional working group for trying the pilot.",
                "member_ids": [row[0] for row in examples], "created_at": now})
