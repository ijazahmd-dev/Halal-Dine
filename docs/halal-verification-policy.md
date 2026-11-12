# Halal Verification Policy & Principles

## 1. Core Verification Philosophy

Halal Dine prioritizes **trust, transparency, and auditability** over directory quantity.

## 2. Inviolable Operational Rules

1. **Ownership $\neq$ Halal Verification:** Approval of a restaurant ownership claim grants profile management rights only; it does NOT grant `VERIFIED_HALAL` status.
2. **Independent Human Review:** AI, automated scrapers, and external APIs are strictly prohibited from setting a restaurant's status to `VERIFIED_HALAL`. An authorized verifier or administrator must review documentation.
3. **Audit Trail:** Every status change is recorded in `VerificationEvent` with actor ID, previous status, new status, timestamp, and notes.
4. **No Pay-for-Status:** Paid advertising or subscriptions will never grant, expedite, or influence verification decisions.
5. **Private Document Storage:** All submitted certificates, meat supplier bills, and trade licenses must be stored in secure, private S3 buckets and accessed only via short-lived signed URLs.
