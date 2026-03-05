# KT: Router + Service Layer (Support, Medical, Karnataka Engineering)

Last updated: 2026-03-05

## Purpose
- This KT covers both:
- Router layer (request validation, auth, response shaping)
- Service layer (business logic, DB calls, recommendation logic, storage/email/payment integrations)

Files in scope:
- `future_bridge/api/v1/supportRouters.py`
- `future_bridge/api/v1/medicalRouters.py`
- `future_bridge/api/v1/karnatakaEngineeringRouters.py`
- `future_bridge/services/supportService.py`
- `future_bridge/services/medicalService.py`
- `future_bridge/services/karnatakaEngineeringService.py`

## Architecture Summary
- Routers:
- Enforce `Depends(jwtBearer())`
- Extract token via `get_token_from_header(request)`
- Validate token via `validate_google_token(...)`
- Perform request-level validations and normalization
- Delegate to service layer
- Wrap output in response schemas

- Services:
- Convert request schema to domain model when needed
- Execute business rules
- Call repositories for DB read/write
- Integrate with Azure Blob, email, and payment config/status

- Repositories:
- Persist and query data (Mongo/DB collections)
- Provide filtered/sorted/paginated fetches and recommendation source data

---

## Common Auth and Error Handling Notes
- All listed routes are JWT protected using `Depends(jwtBearer())`.
- Token validation shape is not fully consistent in router usage:
- Some handlers use `is_valid, email = validate_google_token(token)`
- Some handlers treat return as boolean or index tuple directly
- KT recommendation: standardize utility contract to always return `(is_valid, email_or_none)`.

- Typical router errors:
- `401` for invalid/expired token
- `422` for payload validation mismatches
- `400` for normalization failures (example: Maharashtra college code must be numeric)
- `500` for unhandled failures (with logging)

---

## Support Module KT

### Router responsibilities (`supportRouters.py`)
- `/raise_issues`:
- Validates token
- Parses user-agent to browser/os/device metadata
- Validates max 2 attachments, extension whitelist, per-file size limit 100 MB
- Uploads files through service, then stores ticket

- `/tickets`:
- Validates `page >= 1`, `10 <= limit <= 100`
- Delegates filtered list retrieval

- `/tickets/username`, `/tickets/{ticket_id}`:
- Delegates user-specific or id-specific ticket lookup

- `/tickets-export`:
- Delegates CSV generation and returns `StreamingResponse`

- `/tickets/bulk-action`, `/metrics`:
- Delegates bulk state changes and dashboard metrics fetch

- `/tickets/{ticket_id}/comments`:
- Validates token
- Delegates comment creation + attachment handling + notifications

### Service responsibilities (`supportService.py`)
- `upload_to_blob(filename, data)`:
- Creates unique blob name (UUID + original extension)
- Uploads to Azure Blob container using `BlobServiceClient` from connection string
- Returns blob URL

- `store_user_tickets(support_request, browser_info, files)`:
- Builds `Support` model from payload + browser info + attachments
- Stores via repository
- Sends ticket copy email to end user and CC support if insert succeeded

- `send_ticket_copy(ticket_data)`:
- Formats created timestamp in IST
- Sends HTML email via `MicrosoftEmailService().process_request(...)`

- `export_tickets_as_csv(status, ticket_ids)`:
- Pulls export rows from repository
- Writes CSV in-memory (`io.StringIO`)
- Returns stream for router response

- `upload_attachments(files)`:
- Validates allowed extensions
- Validates total combined attachment size <= 100 MB
- Uploads each file and returns blob URL list

- `add_comment_to_ticket(ticket_id, payload, files)`:
- Verifies ticket exists
- Uploads attachments
- Builds `Comments` model and appends via repository
- Sends email notification on successful update

- `send_comment_notification(...)`:
- Sends HTML email to ticket owner + support CC

- Pass-through service methods:
- `get_all_tickets`, `get_ticket_by_id`, `get_tickets_by_username`
- `perform_bulk_action`
- `get_support_metrics`
- `get_tickets_for_export`

### Integrations
- Azure Blob Storage: attachment uploads
- Microsoft email service: ticket copy + comment notifications
- Support repository: ticket CRUD/filter/export/metrics

---

## Medical Module KT

### Router responsibilities (`medicalRouters.py`)
- `/student/configuration`:
- Validates token and enforces token email == payload username
- Delegates store/update
- Returns `201` when operation is `created`, else `200`

- `/student/details`:
- Uses token email + state to fetch saved configuration

- `/medical/recommendations`:
- Validates token
- Normalizes `last_round_college_choice_code` via `normalize_college_code(...)` when provided
- Delegates recommendation generation

- `/medical/recommendations/college-list`:
- Fetches stored recommendation groups by email + round + state

- `/college/search/name` and `/college/search/code`:
- Delegates search; code endpoint normalizes code by state

- `normalize_college_code(...)`:
- `State.MAHARASHTRA`: code must be numeric, returns `int`, else HTTP 400
- `State.KARNATAKA`: uppercase string
- Others: uppercase string

- `/store_medical_college_details`:
- Validates required fields
- Normalizes `collegeCode`
- Delegates persistence

- `/get_medical_user_round_details`:
- Delegates retrieval by token email + round + state

### Service responsibilities (`medicalService.py`)
- `generate_medical_configuration(request_data)`:
- Builds `MedicalConfiguration` model
- Stores via repository

- `retrieve_medical_configuration(email, state)`:
- Fetches latest/saved config

- `generate_medical_recommendations(request_data)`:
- Reads round, optional last-round choice, and user config
- Extracts category, gender, rank, preferred programs/cities/state/college types
- Optionally computes previous-round threshold (`search_highestAIR`) for rounds >1
- Fetches relevant cutoff rows using repository filters
- Resolves payment flags:
- `is_payment` from medical repository
- `accept_payment` from payment repository config
- For each candidate row:
- Selects best matching cutoff (state-specific)
- Karnataka uses category-only cutoff match
- Other states use category + gender cutoff match
- Computes admission probability from rank-to-cutoff ratio (14-bucket model: 99..10)
- Builds probability message and recommendation item
- Deduplicates by `(college_code, program)` keeping stronger probability/cutoff
- Applies last-round filter if `highest_air_value` exists
- Buckets results into `Dream/Reach/Match/Safety`
- Applies overflow limits from settings:
- `MEDICAL_DREAM_LIMIT`, `MEDICAL_REACH_LIMIT`, `MEDICAL_MATCH_LIMIT`, `MEDICAL_SAFETY_LIMIT`
- Stores grouped recommendation payload
- Returns grouped response

- `_empty_response(...)`:
- Returns/stores empty recommendation skeleton with payment flags

- `get_medical_college_recommendation_list_round(email, round, state)`:
- Returns stored grouped recommendations
- If none found, returns empty valid structure (prevents schema failures)
- Refreshes payment flags

- Search and round-details methods:
- `search_college_by_college_name`
- `search_college_by_college_code`
- `store_medical_college_details` (maps request to `MedicalCollegeDetails`)
- `get_medical_user_round_details`

### Integrations
- Medical repository: configuration, cutoff retrieval, recommendations, round details
- Payment repository: payment success/config flags for response gating

---

## Karnataka Engineering Module KT

### Router responsibilities (`karnatakaEngineeringRouters.py`)
- `/store-engineering-user-config/`:
- Validates token
- Enforces token email == payload username
- Delegates config upsert
- Sets dynamic status `201` or `200` based on operation

- `/fetch-engineering-user-config`:
- Fetches saved config by token email
- Returns successful empty-data response when not found

- `/recommendation/college-list` `POST`:
- Validates token
- Delegates recommendation generation and returns grouped output

- `/recommendation/college-list` `GET`:
- Fetches stored grouped recommendations by token email + round

- `/store_engineering_round_college_details`:
- Validates token
- Enforces required payload fields
- Delegates store

- `/get_engineering_round_college_details`:
- Delegates retrieval by token email + selected round

- `/search_college_by/college_name` and `/search_college_by/college_code`:
- Validates token and delegates search

### Service responsibilities (`karnatakaEngineeringService.py`)
- `store_engineering_user_config(payload)`:
- Persists user config via repository

- `retrieve_engineering_user_config(email)`:
- Fetches user config

- `resolve_branches_by_group(branch_groups)`:
- Expands enum branch groups using `ENGINEERING_BRANCH_GROUP_MAP`
- De-duplicates resulting branches

- `generate_college_recommendations(payload, email)`:
- Extracts category, CET rank, selected branch groups, cities, gender, round
- Expands branch groups to concrete branches
- Returns empty grouped structure if mandatory inputs missing
- For rounds >1 with last-round selected college+course, fetches previous-year round cutoff
- Retrieves cutoff dataset filtered by category/round/course/cities/gender and previous-round condition
- Resolves payment flags:
- `is_payment` from engineering repository
- `accept_payment` from payment repository config
- Builds recommendation entries with:
- college/course metadata
- user rank and category
- cutoff
- probability score + message
- Groups by probability:
- Dream: 10-49
- Reach: 50-74
- Match: 75-89
- Safety: >=90
- Applies overflow limits from settings:
- `ENGINEERING_DREAM_LIMIT`, `ENGINEERING_REACH_LIMIT`, `ENGINEERING_MATCH_LIMIT`, `ENGINEERING_SAFETY_LIMIT`
- Persists grouped result per round
- Returns grouped response

- `_calculate_probability(last_year_cutoff, cet_rank)`:
- Ratio-based score model (99..10) + message text

- `get_college_recommendation_list(email, round)`:
- Fetches stored grouped recommendations
- If found, updates payment flags before returning
- If not found, returns empty grouped structure

- Round detail and search methods:
- `store_engineering_round_college_details`
- `get_engineering_round_college_details`
- `search_college_by_college_name`
- `search_college_by_college_code`

### Integrations
- Karnataka engineering repository: config, cutoff retrieval, recommendations, round details, searches
- Payment repository: payment flags

---

## Router-to-Service Method Map

Support:
- `POST /raise_issues` -> `upload_to_blob` (per file), `store_user_tickets`
- `GET /tickets` -> `get_all_tickets`
- `GET /tickets/username` -> `get_tickets_by_username`
- `GET /tickets/{ticket_id}` -> `get_ticket_by_id`
- `POST /tickets-export` -> `export_tickets_as_csv`
- `PATCH /tickets/bulk-action` -> `perform_bulk_action`
- `GET /metrics` -> `get_support_metrics`
- `POST /tickets/{ticket_id}/comments` -> `add_comment_to_ticket`

Medical:
- `POST /student/configuration` -> `generate_medical_configuration`
- `GET /student/details` -> `retrieve_medical_configuration`
- `POST /medical/recommendations` -> `generate_medical_recommendations`
- `GET /medical/recommendations/college-list` -> `get_medical_college_recommendation_list_round`
- `GET /college/search/name` -> `search_college_by_college_name`
- `GET /college/search/code` -> `search_college_by_college_code`
- `POST /store_medical_college_details` -> `store_medical_college_details`
- `GET /get_medical_user_round_details` -> `get_medical_user_round_details`

Karnataka Engineering:
- `POST /store-engineering-user-config/` -> `store_engineering_user_config`
- `GET /fetch-engineering-user-config` -> `retrieve_engineering_user_config`
- `POST /recommendation/college-list` -> `generate_college_recommendations`
- `GET /recommendation/college-list` -> `get_college_recommendation_list`
- `POST /store_engineering_round_college_details` -> `store_engineering_round_college_details`
- `GET /get_engineering_round_college_details` -> `get_engineering_round_college_details`
- `POST /search_college_by/college_name` -> `search_college_by_college_name`
- `POST /search_college_by/college_code` -> `search_college_by_college_code`

---

## Handover Checklist (Service-Aware)
- Confirm env vars/secrets:
- DB URIs, DB names, collection names
- Azure blob connection string and container
- Email provider settings for `MicrosoftEmailService`
- Google JWT validation settings/client IDs

- Confirm recommendation settings in config:
- Medical and engineering Dream/Reach/Match/Safety limits
- Any state/category cutoff source assumptions in repositories

- Verify token validator contract consistency across routers and utils:
- `future_bridge.utils.google.token_validator`
- `future_bridge.utils.google.token_validation`

- Run API smoke tests for:
- Auth failure paths (401)
- Validation paths (422/400)
- Empty recommendation read paths
- File upload + comment notification path (support)
