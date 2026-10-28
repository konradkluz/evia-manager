# The schema of the result of the restore test (EVM-084 AC3): one strict whitelist, used by run.sh to validate the untrusted result
# object and by the contract test with the real publish() of vm-restore.sh. Input: the result; --arg run (expected runId), --arg iso (regex).
def count: type == "number" and . >= 0 and . == floor;
type == "object"
and ((keys - ["runId","status","stage","startedAt","finishedAt","targetTime","restoredTo","rpoSeconds","dbTables","dbRows","mediaFiles","mediaSampleVerified","deletionRegisterEntries"]) | length == 0)
and .runId == $run and (.status | IN("ok","failed")) and (.stage | type == "string" and test("^[a-z]{1,16}$"))
and (.startedAt | type == "string" and test($iso)) and (.finishedAt | type == "string" and test($iso))
and (.targetTime | type == "string" and test($iso)) and (.restoredTo | type == "string" and test($iso))
and (.rpoSeconds | count) and (.dbTables | count) and (.dbRows | count) and (.mediaFiles | count)
and (.mediaSampleVerified | count) and (.deletionRegisterEntries | count)
