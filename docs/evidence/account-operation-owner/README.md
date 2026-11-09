# Current-owner operation predicate

Base `dbd70f9d810330099b754281b70d511a60f62cf8`. The Hub could retain an Unknown operation after the same name
was opened with a replacement credential. SendAsync correctly refused it, but the UI had no read-only operation
ownership query and could continue offering an unusable retry.

`AccountApiService.IsCurrentOwner(AccountMutation)` requires this service's exact registered object and the same
current admitted owner/scope/name/token predicate already used by SendAsync. Null, foreign-service, opening,
cancelled, stale and replacement-credential operations return false. Reopening with the original confirmed credential
can return true again. The query does not send, retry, change state, export credentials, resolve Unknown or discard its
pending metadata. UI must still check the operation state and require an explicit retry; SendAsync remains authoritative.

Three new tests exercise registration isolation/read-only behavior, opening/cancellation/reopen, and actual same-name
credential replacement through the ordinary rejected-key/recovery path. The last preserves the original UUID and
Unknown history while the stale send remains NoOwner without I/O. The affected AccountApiService suite passes31/31;
canonical and Unity mirrors match. No Editor, browser, cloud, gameplay, account-claim or mutation behavior changes.
Hub adoption and actual runtime review remain separate.
