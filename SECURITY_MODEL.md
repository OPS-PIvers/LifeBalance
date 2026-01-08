# LifeBalance Security Model

## Overview
This document describes the security model for household access control and invite system.

## Core Security Principles

### 1. Household Creation & Ownership
- Any authenticated user can create a household
- The creator is recorded in the `createdBy` field (immutable)
- The creator becomes the first admin member
- An invite code is automatically generated

### 2. Invite Code System
**Attack Prevention**: Only household creators can issue invite codes.

**Restrictions**:
- Only the household creator (verified via `createdBy` field) can create invite codes
- Invite codes reference a specific `householdId`
- Invite codes cannot be modified or deleted after creation
- Invite codes can only be read individually (listing is disabled to prevent enumeration)

**Rationale**: Prevents attackers from creating fake invite codes to join arbitrary households.

### 3. Household Joining
**Attack Prevention**: Users can only join via valid invite codes issued by the household creator.

**Process**:
1. User provides an invite code
2. System verifies the invite code exists and maps to a household
3. User creates their member document with the invite code
4. Rules verify the invite code's `householdId` matches the target household
5. Non-creators cannot assign themselves admin role when joining

**Restrictions**:
- Users joining via invite cannot set their role to 'admin'
- Users can only create a member document for themselves (`memberId` must equal their UID)

### 4. Privilege Escalation Prevention
**Attack Prevention**: Members cannot modify fields that control authorization.

**Immutable Household Fields**:
- `createdBy`: The UID of the household creator (used for invite code creation authorization)
- `createdAt`: Timestamp of household creation
- `inviteCode`: The household's invite code

**Rationale**: Without this protection, a malicious member could:
1. Change `createdBy` to their own UID
2. Create unauthorized invite codes for the household
3. Potentially gain admin privileges through other attack vectors

### 5. Role Management
**Attack Prevention**: Only admins can promote/demote members.

**Restrictions**:
- Regular members can update their own profile fields
- Only admins can modify the `role` field
- Self-service role escalation is blocked

## Security Flow Diagrams

### Household Creation Flow
```
User (authenticated)
  └─> Create Household Document
       └─> Set createdBy = User.UID (IMMUTABLE)
       └─> Generate Invite Code
            └─> Create inviteCodes/{code} Document
                 └─> Verified: creator check via createdBy field
                 └─> Set householdId
  └─> Create Member Document (admin role)
       └─> Verified: createdBy matches User.UID
```

### Joining via Invite Code Flow
```
User (authenticated)
  └─> Provide Invite Code
       └─> Lookup inviteCodes/{code}
            └─> Verify exists
            └─> Get householdId
  └─> Create Member Document
       └─> Verify invite code exists and matches householdId
       └─> Block admin role assignment for non-creators
       └─> Set role = 'member'
  └─> Add user to household.memberUids array
```

## Known Attack Vectors (Mitigated)

### ❌ Attack 1: Fake Invite Code Creation (MITIGATED)
**Scenario**: Attacker creates invite code for any household.
**Mitigation**: Lines 97-98 in `firestore.rules` require `createdBy` check.

### ❌ Attack 2: Privilege Escalation via createdBy Modification (MITIGATED)
**Scenario**: Member changes `createdBy` to their UID, then creates invite codes.
**Mitigation**: Line 31 in `firestore.rules` blocks modification of `createdBy`, `createdAt`, `inviteCode`.

### ❌ Attack 3: Self-Service Admin Role (MITIGATED)
**Scenario**: User joins via invite and sets role to 'admin'.
**Mitigation**: Lines 54-58 in `firestore.rules` block admin role assignment for invite-based joins.

### ❌ Attack 4: Role Escalation via Update (MITIGATED)
**Scenario**: Member updates their member document to change role to 'admin'.
**Mitigation**: Lines 63-69 in `firestore.rules` require admin privileges to modify `role` field.

## Security Testing Checklist

- [ ] Verify non-creator cannot create invite codes
- [ ] Verify member cannot modify `createdBy` field
- [ ] Verify member cannot modify `inviteCode` field
- [ ] Verify member cannot modify `createdAt` field
- [ ] Verify user joining via invite cannot set admin role
- [ ] Verify member cannot update their own role to admin
- [ ] Verify invite codes cannot be listed (only individual get)
- [ ] Verify invite codes cannot be updated after creation
- [ ] Verify invite codes cannot be deleted

## References

- Original Security Fix: Commit aa7ed23
- Privilege Escalation Fix: Commit c12c5a5
- Related PR: #42
- Review Thread: https://github.com/OPS-PIvers/LifeBalance/pull/42#discussion_r2670485733
