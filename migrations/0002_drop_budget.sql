-- ADR-009: the per-minute TfL budget cost a D1 write per refresh and per station lookup. The refresh lease
-- already caps line refreshes; station lookups use an in-memory limit. Free-tier writes are shared with
-- other sites on the account.
DROP TABLE IF EXISTS tfl_budget;
