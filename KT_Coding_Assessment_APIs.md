# KT: Coding Assessment APIs (Router + Service Layer)

Last updated: 2026-03-05

## Purpose
- This KT covers coding assessment APIs under `app/api/v1/coding_assessment`.
- Scope includes:
- Router layer (request handling, auth dependency usage, response shaping)
- Service layer (business rules, token/session/question/submission logic, Judge0 execution)
- Repository layer (Mongo persistence and retrieval)

Files in scope:
- `app/api/v1/coding_assessment/create_coding_assessment_router.py`
- `app/api/v1/coding_assessment/coding_questions_routers.py`
- `app/api/v1/coding_assessment/coding_questionnaire_routers.py`
- `app/api/v1/coding_assessment/coding_sessions_routers.py`
- `app/api/v1/coding_assessment/coding_assessment_routers.py`
- `app/services/create_coding_assessment_service.py`
- `app/services/coding_question.py`
- `app/services/coding_session_service.py`
- `app/services/coding_assessment_service.py`
- `app/services/judge0_service.py`
- `app/services/assessment_service.py` (token validation dependency used by coding sessions)
- `app/repositories/assessment.py`
- `app/repositories/question.py`
- `app/repositories/session.py`
- `app/repositories/attempt.py`
- `app/repositories/submission.py`

API prefixes from `app/api/v1/router.py`:
- `/coding_assessment`
- `/create_coding_assessment`
- `/coding_questions`
- `/coding_questionnaire`
- `/coding_sessions`

---

## Architecture Summary
- Routers:
- Accept payload/path/query params
- Apply auth where configured (`Depends(get_current_user)`)
- Delegate business work to service layer
- Raise `NotFoundError` in specific lookup/delete paths

- Services:
- Implement business logic (config inheritance, question transformation, session rules, code evaluation/grading)
- Call repositories for DB operations
- Integrate with assessment token validation and Judge0 execution

- Repositories:
- Persist/retrieve from Mongo collections:
- `coding_assessments`
- `coding_assessment_questions`
- `coding_assessment_sessions`
- `coding_assessment_attempts`
- `coding_assessment_submissions`

---

## Common Auth and Error Handling Notes
- Protected endpoints (JWT via `get_current_user`):
- `POST /coding_assessment/run`
- `POST /coding_assessment/submit`
- All `/coding_sessions/*` endpoints

- Not currently protected in these router files:
- All `/create_coding_assessment/*`
- All `/coding_questions/*`
- `GET /coding_questionnaire/display/{session_id}`

- Error handling is standardized via app-level handlers in `app/main.py`:
- `RequestValidationError` -> `422`
- `AppError` subclasses:
- `NotFoundError` -> `404`
- `ConflictError` -> `409`
- `ValidationError` -> `422`
- `SystemError` -> `500`
- Unhandled exceptions -> `500`

---

## Module 1: Assessment Configuration KT

### Router responsibilities (`create_coding_assessment_router.py`)
- `POST /create_assessment`:
- Delegates create/upsert request to service

- `GET /read_assessments`:
- Delegates list retrieval

- `GET /read_assessment/{reference_id}` and `GET /read_assessment_by_id/{assessment_id}`:
- Delegates lookup
- Raises `NotFoundError` when missing

- `PUT /update_assessment/{reference_id}`:
- Delegates partial update
- Raises `NotFoundError` when target missing

- `GET /read_assessment_questions/{reference_id}`:
- Delegates composite fetch (assessment + questions grouped per section)

- `DELETE /delete_assessment/{reference_id}`:
- Delegates soft delete
- Returns `APIResponse` with `RESOURCE_DELETED`

### Service responsibilities (`create_coding_assessment_service.py`)
- `create_assessment(...)`:
- Inherits missing section-level defaults from global assessment config
- Preserves `configuration_id` and `created_at` on upsert if assessment exists
- Sets `updated_at` on updates
- Writes via repository upsert

- `update_assessment(...)`:
- Supports partial updates using `exclude_unset`
- Re-processes sections with fallback defaults using existing/global values
- Updates `updated_at`

- `get_assessment_structure(...)`:
- Fetches assessment and all related questions
- Groups questions by `section_id`
- Sorts each section�s questions by `order`
- Returns enriched `AssessmentWithQuestionsResponse`

- Other methods:
- `get_assessment`, `get_assessment_by_id`, `get_all_assessments`, `delete_assessment`

### Integrations
- Assessment repository: create/upsert/read/update/soft delete/list
- Question repository: fetch questions by assessment for structure response

---

## Module 2: Coding Questions KT

### Router responsibilities (`coding_questions_routers.py`)
- `POST /create_coding_questions`:
- Accepts single question, list of questions, or questionnaire wrapper
- Branches to bulk/single service logic based on payload type

- `GET /by-assessment`:
- Returns questions for `reference_id`
- Returns empty list when `reference_id` not provided

- `GET /{question_id}`:
- Fetches a specific question

- `PUT /{question_id}`:
- Delegates partial update behavior to service

- `DELETE /{question_id}`:
- Delegates soft delete

### Service responsibilities (`coding_question.py`)
- `create_coding_questions(...)`:
- Normalizes input variants into common question objects
- Resolves inherited fields from questionnaire wrapper
- Validates parent assessment existence
- Resolves `section_id` from `section_name` when needed
- Builds `QuestionInDB` objects
- Supports flattened coding fields and legacy `problems` list mode
- Auto-generates default title from problem statement when absent
- Persists via bulk create/upsert

- `update_question(...)`:
- Fetches existing question
- Applies partial updates (top-level fields + problem details)
- Preserves non-updated problem fields
- Updates timestamp

- `delete_question(...)`:
- Soft delete after existence check

- Retrieval methods:
- `get_questions_by_assessment`, `get_question_by_id`, `get_questions_bulk_retrieve`

### Integrations
- Assessment repository: parent assessment validation
- Question repository: create_many/upsert, retrieve, update, soft delete

---

## Module 3: Coding Sessions + Questionnaire Display KT

### Router responsibilities (`coding_sessions_routers.py`)
- `POST /start`:
- Protected endpoint
- Delegates session creation/resume flow

- `GET /{session_id}`:
- Protected endpoint
- Delegates session fetch

- `POST /finish/{session_id}`:
- Protected endpoint
- Delegates manual end flow

- `PATCH /{session_id}/reattempt`:
- Protected endpoint
- Delegates reattempt flag toggle

### Router responsibilities (`coding_questionnaire_routers.py`)
- `GET /display/{session_id}`:
- Validates session existence
- Fetches assessment questions
- Fetches attempts for session
- Masks answer keys and hidden testcase details
- Merges attempt status into question response

### Service responsibilities (`coding_session_service.py`)
- `start_session(...)`:
- Validates invite token through `AssessmentService.validate_token(..., coding_session=True)`
- Validates assessment existence and active time window (`start_date/end_date`)
- Prevents duplicate attempts by returning existing active session
- Creates new session with computed `expires_at` using assessment `global_duration`

- `end_session(...)`:
- Allows transition only from `IN_PROGRESS` to `ENDED`

- `toggle_reattempt_allowed(...)`:
- Updates reattempt flag for target session

- `check_and_expire_sessions(...)`:
- Expires timed-out sessions in batch

### Integrations
- Assessment service: token decode/validation and config existence verification
- Session repository: create/read/active lookup/status updates/reattempt toggles/expiry batch update
- Assessment repository: assessment availability and time-window validation
- Attempt repository (questionnaire display router): fetch attempt status per question

---

## Module 4: Code Run + Submission KT

### Router responsibilities (`coding_assessment_routers.py`)
- `POST /run`:
- Protected endpoint
- Delegates transient execution (no persistence)

- `POST /submit`:
- Protected endpoint
- Delegates grading + persistence flow

### Service responsibilities (`coding_assessment_service.py`)
- `run_code(...)`:
- Resolves Judge0 language ID (fallback to Python)
- Uses payload or question-defined execution limits
- Mode A (test case mode): evaluates all public+hidden test cases
- Mode B (simple mode): executes with custom input
- Maps Judge0 status IDs to internal submission status
- Returns execution output + testcase summaries

- `_evaluate_test_cases(...)`:
- Executes code per testcase through Judge0
- Builds `TestCaseResult` for each case
- Stops early on compilation error

- `submit_code(...)`:
- Validates session and question
- Supports client-trusted result mode when attempt is not `SUBMITTED`
- For server-validation mode, executes against all DB test cases
- Supports `SKIPPED` attempt path (stores submission without execution)
- Masks hidden testcase details in response payload
- Persists full submission to DB
- Upserts per-question attempt snapshot (status/code/language/score)

- Extra helper methods:
- `run_tests`, `execute_custom_test` (not directly exposed by current routers)

### Judge0 integration (`judge0_service.py`)
- Executes via `/submissions?base64_encoded=true&wait=true`
- Base64 encodes request payload fields and decodes response fields
- Handles HTTP/API failures with standardized fallback response
- Central status mapping from Judge0 status IDs to internal enum

### Integrations
- Question repository: question/testcase/limits fetch
- Session repository: session validation
- Submission repository: submission insert
- Attempt repository: upsert attempt state after submit
- Judge0 API: compile/execute/evaluate
- Language mapping service: user language -> Judge0 language ID

---

## Router-to-Service Method Map

`/create_coding_assessment`:
- `POST /create_assessment` -> `CreateCodingAssessmentService.create_assessment`
- `GET /read_assessments` -> `CreateCodingAssessmentService.get_all_assessments`
- `GET /read_assessment/{reference_id}` -> `CreateCodingAssessmentService.get_assessment`
- `GET /read_assessment_by_id/{assessment_id}` -> `CreateCodingAssessmentService.get_assessment_by_id`
- `PUT /update_assessment/{reference_id}` -> `CreateCodingAssessmentService.update_assessment`
- `GET /read_assessment_questions/{reference_id}` -> `CreateCodingAssessmentService.get_assessment_structure`
- `DELETE /delete_assessment/{reference_id}` -> `CreateCodingAssessmentService.delete_assessment`

`/coding_questions`:
- `POST /create_coding_questions` -> `CodingQuestionService.create_coding_questions` / `create_coding_questions_bulk`
- `GET /by-assessment` -> `CodingQuestionService.get_questions_by_assessment`
- `GET /{question_id}` -> `CodingQuestionService.get_question_by_id`
- `PUT /{question_id}` -> `CodingQuestionService.update_question`
- `DELETE /{question_id}` -> `CodingQuestionService.delete_question`

`/coding_questionnaire`:
- `GET /display/{session_id}` -> router-level orchestration + `CodingQuestionService.get_questions_by_assessment`

`/coding_sessions`:
- `POST /start` -> `CodingSessionService.start_session`
- `GET /{session_id}` -> `CodingSessionService.get_session_by_id`
- `POST /finish/{session_id}` -> `CodingSessionService.end_session`
- `PATCH /{session_id}/reattempt` -> `CodingSessionService.toggle_reattempt_allowed`

`/coding_assessment`:
- `POST /run` -> `CodingAssessmentService.run_code`
- `POST /submit` -> `CodingAssessmentService.submit_code`

---

## Compact Sequence Flows (with Business Logic)

1. `POST /create_coding_assessment/create_assessment`
- Request -> Router accepts `AssessmentConfigCreate` -> Service applies section default inheritance + upsert prep -> Repository `assessment_repository.create` (upsert by `reference_id`) -> `201 AssessmentConfigResponse`.

2. `GET /create_coding_assessment/read_assessments`
- Request -> Router delegates -> Service loads all non-deleted configs -> Repository `assessment_repository.get_all` -> `200 List[AssessmentConfigResponse]`.

3. `GET /create_coding_assessment/read_assessment/{reference_id}`
- Request -> Router delegates + not-found check -> Service fetches by reference -> Repository `assessment_repository.get_by_id` -> `200` or `404`.

4. `GET /create_coding_assessment/read_assessment_by_id/{assessment_id}`
- Request -> Router delegates + not-found check -> Service fetches by assessment_id -> Repository `assessment_repository.get_by_assessment_id` -> `200` or `404`.

5. `PUT /create_coding_assessment/update_assessment/{reference_id}`
- Request -> Router accepts partial payload + not-found check -> Service merges `exclude_unset`, reprocesses sections, sets `updated_at` -> Repository `assessment_repository.update` -> `200` or `404`.

6. `GET /create_coding_assessment/read_assessment_questions/{reference_id}`
- Request -> Router delegates + not-found check -> Service fetches assessment + questions, groups by section, sorts by `order` -> Repositories `assessment_repository.get_by_id` + `question_repository.get_by_assessment_id` -> `200` or `404`.

7. `DELETE /create_coding_assessment/delete_assessment/{reference_id}`
- Request -> Router delegates + not-found check -> Service performs soft delete -> Repository `assessment_repository.delete` (`is_deleted=True`) -> `200 APIResponse` or `404`.

8. `POST /coding_questions/create_coding_questions`
- Request -> Router branches single/bulk/wrapper mode -> Service normalizes input, validates assessment, resolves section mapping, builds coding problem payloads -> Repository `question_repository.create_many` (per-item upsert) -> `201` with question list or questionnaire response.

9. `GET /coding_questions/by-assessment`
- Request -> Router checks `reference_id` presence -> Service fetches list when present -> Repository `question_repository.get_by_assessment_id` -> `200 list` or empty list.

10. `GET /coding_questions/{question_id}`
- Request -> Router delegates -> Service validates existence -> Repository `question_repository.get_by_id` -> `200` or `404`.

11. `PUT /coding_questions/{question_id}`
- Request -> Router delegates -> Service fetches existing, applies partial top-level/problem-field merge -> Repository `question_repository.update` -> `200` or `404/500`.

12. `DELETE /coding_questions/{question_id}`
- Request -> Router delegates -> Service validates existence then soft deletes -> Repository `question_repository.delete` -> `200` or `404/500`.

13. `GET /coding_questionnaire/display/{session_id}`
- Request -> Router validates session exists -> Router fetches assessment questions + session attempts -> Router masks hidden testcases and answer keys, merges attempt status -> Repositories `session_repository.get_by_id`, `attempt_repository.get_by_session_id` (+ service `get_questions_by_assessment`) -> `200 List[QuestionResponse]` or `404`.

14. `POST /coding_sessions/start`
- Request -> Router auth (`get_current_user`) -> Service validates invite token, assessment window, duplicate active session -> Repositories/services `AssessmentService.validate_token`, `assessment_repository.get_by_id`, `session_repository.get_active_session/create` -> `201 SessionResponse` (or existing active session response) / `404/409/500`.

15. `GET /coding_sessions/{session_id}`
- Request -> Router auth -> Service fetches by session ID -> Repository `session_repository.get_by_id` -> `200` or `404`.

16. `POST /coding_sessions/finish/{session_id}`
- Request -> Router auth -> Service validates `IN_PROGRESS` then marks `ENDED` -> Repository `session_repository.get_by_id` + `update_session_status` -> `200` or `404/500`.

17. `PATCH /coding_sessions/{session_id}/reattempt`
- Request -> Router auth -> Service toggles reattempt flag -> Repository `session_repository.update_reattempt_allowed` -> `200` or `404`.

18. `POST /coding_assessment/run`
- Request -> Router auth -> Service resolves language/limits and executes (simple or testcase mode) -> Repository `question_repository.get_by_id` (optional when `question_id` supplied) + Judge0 API execution -> `200 RunCodeResponse`.

19. `POST /coding_assessment/submit`
- Request -> Router auth -> Service validates session/question, chooses trusted FE mode or server-side Judge0 evaluation, masks hidden-case response, stores submission, upserts attempt -> Repositories `session_repository.get_by_id`, `question_repository.get_by_id`, `submission_repository.create`, `attempt_repository.upsert_attempt` (+ Judge0 API) -> `201 SubmissionResponse` or `404/500`.

---

## Handover Checklist (Service-Aware)
- Confirm env vars/secrets in `.env`:
- `MONGODB_URL`, `DATABASE_NAME`
- `JWT_SECRET_KEY`, `ALGORITHM`, token expiry settings
- `ENCRYPTION_SECRET_KEY`, `FRONTEND_URL`, `CORS_ORIGINS`
- `JUDGE0_API_URL`, `JUDGE0_API_KEY`, `JUDGE0_RAPIDAPI_HOST`

- Confirm DB collections and indexes:
- `coding_assessments` unique index on `reference_id`, `configuration_id`
- `coding_assessment_attempts` unique `(session_id, question_id)`
- Additional indexes for high-volume read paths (`reference_id`, `candidate_id`, session queries)

- Validate auth expectations:
- Ensure intended endpoints are protected (currently create/questions/questionnaire-display are open in router code)
- Verify whether `PATCH /coding_sessions/{session_id}/reattempt` requires explicit admin-role authorization beyond bearer token

- Run smoke tests for:
- Assessment create/read/update/delete and structure retrieval
- Question create (single/bulk/wrapper), update, soft delete
- Session start/resume/finish/reattempt
- Code run simple mode and testcase mode
- Submission in `SUBMITTED`, `SKIPPED`, and client-trusted non-submitted modes
- Hidden testcase masking behavior in run/submit responses

## Implementation Notes / Observed Behavior
- Assessment create uses repository upsert by `reference_id` (route name says create, behavior is create-or-update).
- `GET /coding_questions/by-assessment` ignores `section_name` currently and returns `[]` when `reference_id` is absent.
- In run-code testcase mode, response includes both `test_results` and `hidden_test_cases_results`; verify desired data exposure policy for hidden cases.
