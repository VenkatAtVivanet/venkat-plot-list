# KT: Endpoint Sequence Flows (Router -> Service -> Repository)

Last updated: 2026-03-05

## Scope
- `future_bridge/api/v1/supportRouters.py`
- `future_bridge/api/v1/medicalRouters.py`
- `future_bridge/api/v1/karnatakaEngineeringRouters.py`
- `future_bridge/services/supportService.py`
- `future_bridge/services/medicalService.py`
- `future_bridge/services/karnatakaEngineeringService.py`

## Global Pattern
- All endpoints in this file are JWT-protected using `Depends(jwtBearer())`.
- Standard flow shape: `Request -> Router checks -> Service methods -> Repository -> Response`.

## Support Endpoints

1. `POST /raise_issues`
- Request: `SupportRequest` form payload + optional files.
- Router checks: token extraction and validation, user-agent parsing, max 2 files, extension whitelist, per-file size <= 100 MB.
- Service methods: `upload_to_blob` (per file, Azure Blob) -> `store_user_tickets` -> `send_ticket_copy` (email on success).
- Business logic: constructs `Support` model with browser metadata and attachment URLs; sends ticket copy only if insert succeeded.
- Repository: `SupportRepository.store_user_tickets`.
- Response: `SupportResponse` success payload; validation failure `422`; unexpected error `500`.

2. `GET /tickets`
- Request: query filters (`status`, `sort`, `page`, `limit`, `include_deleted`).
- Router checks: `page >= 1`, `10 <= limit <= 100`.
- Service methods: `get_all_tickets`.
- Business logic: server-side filtered/sorted/paginated list retrieval via route filter object.
- Repository: `SupportRepository.get_all_tickets`.
- Response: paginated `SupportResponse`; validation failure `422`; unexpected error `500`.

3. `GET /tickets/username`
- Request: query `username`.
- Router checks: token extraction and validation.
- Service methods: `get_tickets_by_username`.
- Business logic: returns user-scoped tickets and response metadata (`total_tickets`).
- Repository: `SupportRepository.get_tickets_by_username`.
- Response: `SupportResponse` with `total_tickets` and `tickets`; auth failure path; unexpected error `500`.

4. `GET /tickets/{ticket_id}`
- Request: path `ticket_id`.
- Router checks: none beyond route auth dependency.
- Service methods: `get_ticket_by_id`.
- Business logic: existence check at router layer before success response.
- Repository: `SupportRepository.get_ticket_by_id`.
- Response: `SupportResponse`; `404` when not found; unexpected error `500`.

5. `POST /tickets-export`
- Request: `ExportTicketsRequest` (`status`, `ticket_ids`).
- Router checks: payload/schema validation.
- Service methods: `export_tickets_as_csv` (builds in-memory CSV stream).
- Business logic: fetches export dataset, writes CSV header + rows, returns stream pointer.
- Repository: `SupportRepository.get_tickets_for_export`.
- Response: `StreamingResponse(text/csv)` file download; `404` if no rows; unexpected error `500`.

6. `PATCH /tickets/bulk-action`
- Request: `BulkActionRequest` (`action`, `ticket_ids`).
- Router checks: payload/schema validation.
- Service methods: `perform_bulk_action`.
- Business logic: applies single action over multiple ticket IDs in one operation.
- Repository: `SupportRepository.perform_bulk_action`.
- Response: `SupportResponse` with bulk update result; unexpected error `500`.

7. `GET /metrics`
- Request: none.
- Router checks: none beyond route auth dependency.
- Service methods: `get_support_metrics`.
- Business logic: returns dashboard aggregates (open/closed/paid/total style metrics).
- Repository: `SupportRepository.get_support_metrics`.
- Response: `SupportResponse` with dashboard metrics; unexpected error `500`.

8. `POST /tickets/{ticket_id}/comments`
- Request: path `ticket_id` + `CommentRequest` form payload + optional files.
- Router checks: token extraction and validation.
- Service methods: `add_comment_to_ticket` -> `upload_attachments` -> `upload_to_blob` (Azure Blob) -> `send_comment_notification` (email on success).
- Business logic: verifies ticket exists, enforces attachment extension/combined-size checks, appends `Comments` model, notifies ticket owner/support.
- Repository: `SupportRepository.get_ticket_by_id` -> `SupportRepository.add_comment_to_ticket`.
- Response: `SupportResponse`; `404` if ticket missing; validation failure `422`; unexpected error `500`.

## Medical Endpoints

1. `POST /student/configuration`
- Request: `MedicalConfigurationRequest`.
- Router checks: token extraction and validation, token email must match payload `username`.
- Service methods: `generate_medical_configuration`.
- Business logic: maps request to `MedicalConfiguration` domain model and upserts configuration.
- Repository: `MedicalRepository.store_medical_configuration`.
- Response: `MedicalConfigurationResponse`; status `201` (created) or `200` (updated); auth failure `401`; validation failure `422`; unexpected error `500`.

2. `GET /student/details`
- Request: query `state`.
- Router checks: token extraction and validation.
- Service methods: `retrieve_medical_configuration`.
- Business logic: fetches latest/saved config by authenticated email + state.
- Repository: `MedicalRepository.retrieve_medical_configuration`.
- Response: `MedicalConfigurationResponse`; auth failure `401`; validation failure `422`; unexpected error `500`.

3. `POST /medical/recommendations`
- Request: `MedicalCollegeRoundPreferencesRequest`.
- Router checks: token extraction and validation, normalize `last_round_college_choice_code` using `normalize_college_code` when present.
- Service methods: `generate_medical_recommendations` -> optional previous-round threshold lookup -> probability grouping -> overflow-limit application -> recommendation persistence.
- Business logic: state-aware cutoff selection (Karnataka category-only vs others category+gender), 14-bucket probability scoring, dedupe by `(college_code, program)`, optional highest-AIR filter for rounds >1, Dream/Reach/Match/Safety grouping with configured limits and payment flags.
- Repository: `MedicalRepository.search_highestAIR` (conditional) -> `MedicalRepository.fetch_cutoff_data` -> `MedicalRepository.is_user_payment_valid` -> `PaymentRepository.get_accept_payment_from_config` -> `MedicalRepository.store_medical_recommendation`.
- Response: `MedicalCollegeRecommendationsResponse`; validation failure `422`; unexpected error `500`.

4. `GET /medical/recommendations/college-list`
- Request: query `round`, `state`.
- Router checks: token extraction and validation.
- Service methods: `get_medical_college_recommendation_list_round` (returns stored or empty grouped structure, refreshes payment flags).
- Business logic: enforces schema-safe empty payload when recommendation record is missing.
- Repository: `MedicalRepository.is_user_payment_valid` -> `PaymentRepository.get_accept_payment_from_config` -> `MedicalRepository.get_medical_college_recommendation_list_round`.
- Response: `MedicalCollegeRecommendationsListResponse`; auth failure `401`; unexpected error `500`.

5. `GET /college/search/name`
- Request: query `college_name`, `state`.
- Router checks: token extraction and validation.
- Service methods: `search_college_by_college_name`.
- Business logic: performs state-scoped fuzzy/name search pass-through.
- Repository: `MedicalRepository.search_college_by_college_name`.
- Response: `dict` message/success/data payload; auth failure `401`; unexpected error `500`.

6. `GET /college/search/code`
- Request: query `college_code`, `state`.
- Router checks: token extraction and validation, normalize code by state (`MAHARASHTRA` numeric else uppercase string).
- Service methods: `search_college_by_college_code`.
- Business logic: enforces Maharashtra integer code contract before repository lookup.
- Repository: `MedicalRepository.search_college_by_college_code`.
- Response: `dict` message/success/data payload; auth failure `401`; normalization failure `400`; unexpected error `500`.

7. `POST /store_medical_college_details`
- Request: `MedicalCollegeDetailsRequest`.
- Router checks: token extraction and validation, required field checks, normalize `collegeCode`.
- Service methods: `store_medical_college_details`.
- Business logic: maps request to `MedicalCollegeDetails` and binds authenticated email (`userName`) before save.
- Repository: `MedicalRepository.store_medical_college_details`.
- Response: `MedicalConfigurationResponse`; validation failure `422`; unexpected error `500`.

8. `GET /get_medical_user_round_details`
- Request: query `round`, `state`.
- Router checks: token extraction and validation.
- Service methods: `get_medical_user_round_details`.
- Business logic: retrieves user-selected round college details for authenticated user and state.
- Repository: `MedicalRepository.get_medical_user_round_details`.
- Response: `MedicalConfigurationResponse`; validation failure `422`; unexpected error `500`.

## Karnataka Engineering Endpoints

1. `POST /store-engineering-user-config/`
- Request: `EngineeringUserConfigRequest`.
- Router checks: token extraction and validation, token email must match payload `username`.
- Service methods: `store_engineering_user_config`.
- Business logic: persists/upserts engineering config and returns operation-based HTTP status.
- Repository: `KarnatakaEngineeringRepository.store_engineering_user_config`.
- Response: success payload; status `201` (created) or `200` (updated); auth failure `401`; validation failure `422`; unexpected error `500`.

2. `GET /fetch-engineering-user-config`
- Request: none.
- Router checks: token extraction and validation.
- Service methods: `retrieve_engineering_user_config`.
- Business logic: fetches latest config for authenticated user and returns success with `data=null` when absent.
- Repository: `KarnatakaEngineeringRepository.retrieve_engineering_user_config`.
- Response: `EngineeringUserConfigResponse`; auth failure `401`; unexpected error `500`.

3. `POST /recommendation/college-list`
- Request: `CollegeRecommendationRequest`.
- Router checks: token extraction and validation.
- Service methods: `generate_college_recommendations` -> `resolve_branches_by_group` -> optional previous-round cutoff lookup -> probability grouping -> overflow-limit application -> recommendation persistence.
- Business logic: expands branch groups, short-circuits to empty groups for missing mandatory inputs, applies ratio-based probability scoring, groups into Dream/Reach/Match/Safety using configured limits, persists round-wise output with payment flags.
- Repository: `KarnatakaEngineeringRepository.get_previous_year_round_cutoff` (conditional) -> `KarnatakaEngineeringRepository.get_cutoff_by_category_course_cities` -> `KarnatakaEngineeringRepository.is_user_payment_valid` -> `PaymentRepository.get_accept_payment_from_config` -> `KarnatakaEngineeringRepository.store_college_recommendations`.
- Response: `CollegeRecommendationListResponse` grouped as Dream/Reach/Match/Safety; auth failure `401`; unexpected error `500`.

4. `GET /recommendation/college-list`
- Request: query `round`.
- Router checks: token extraction and validation.
- Service methods: `get_college_recommendation_list` (returns stored or empty grouped structure, updates payment flags).
- Business logic: if stored response exists, mutates payment flags before return; otherwise returns empty grouped skeleton for selected round.
- Repository: `PaymentRepository.is_user_payment_successful` -> `PaymentRepository.get_accept_payment_from_config` -> `KarnatakaEngineeringRepository.get_college_recommendations_by_email`.
- Response: `CollegeRecommendationListResponse`; auth failure `401`; unexpected error `500`.

5. `POST /store_engineering_round_college_details`
- Request: `CollegeDetails`.
- Router checks: token extraction and validation, required field checks (`college_code`, `college_name`, `course_name`, `round`, `city`, `category`, `cet_rank`).
- Service methods: `store_engineering_round_college_details`.
- Business logic: maps payload to domain model and stores user-selected round college record.
- Repository: `KarnatakaEngineeringRepository.store_engineering_round_college_details`.
- Response: `RoundCollegeDetailsResponse`; validation failure `422`; unexpected error `500`.

6. `GET /get_engineering_round_college_details`
- Request: query `round`.
- Router checks: token extraction and validation.
- Service methods: `get_engineering_round_college_details`.
- Business logic: returns selected college details for authenticated user and selected round.
- Repository: `KarnatakaEngineeringRepository.get_engineering_round_college_details`.
- Response: `RoundCollegeDetailsResponse`; validation failure `422`; unexpected error `500`.

7. `POST /search_college_by/college_name`
- Request: query/body param `college_name`.
- Router checks: token extraction and validation.
- Service methods: `search_college_by_college_name`.
- Business logic: performs name-based pass-through lookup across engineering college dataset.
- Repository: `KarnatakaEngineeringRepository.search_college_by_college_name`.
- Response: `dict` message/success/data payload; auth failure `401`; unexpected error `500`.

8. `POST /search_college_by/college_code`
- Request: query/body param `college_code`.
- Router checks: token extraction and validation.
- Service methods: `search_college_by_college_code`.
- Business logic: performs code-based pass-through lookup for a specific engineering college.
- Repository: `KarnatakaEngineeringRepository.search_college_by_college_code`.
- Response: `dict` message/success/data payload; auth failure `401`; unexpected error `500`.

## Notes for Handover
- Token validator contract is inconsistent across files (`token_validator` vs `token_validation`; boolean vs tuple handling).
- Recommendation responses in Medical and Engineering refresh payment flags at read time.
- Support flows include Azure Blob storage and Microsoft email side effects on create/comment paths.
