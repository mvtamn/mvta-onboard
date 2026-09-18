# Own Roles in OnBoard and Keep Sign-in in Entra

**Status:** proposed

Entra decides who may sign in to OnBoard. OnBoard decides what a signed-in
person may do. A Role is an OnBoard record: a name, a purpose written by an
Access Administrator, and a grid of Module Actions. A person holds Roles
through Role Grants stored in SQL and keyed by Entra object id and tenant id.
Effective Access is the union of the Module Actions of every active Role Grant,
and it is resolved on the server for each request. Modules and their actions
are defined in code; Roles and grants are data edited in Access & Identity.

Human authority used to be Entra app roles carried in the token. Every new
role needed a manual app-role registration and assignment before its code did
anything, a revocation lasted until the token refreshed, the admin pages needed
tenant-wide Graph write consent, and the frontend and backend each kept their
own copies of the role lists, which drifted (Compliance Manager and Access
Administrator both received 403s on their own pages; two roles could not be
granted from the console at all). A token claim also cannot say what a role
grants, so no page could describe access in plain words.

**Decisions:**

- Access is expressed as Module Actions, such as `detours.view`,
  `detours.delete` or `performance-assessment.decide`. Every module has `view`;
  a module without `view` is hidden from navigation and its API refuses the
  caller. Endpoints check an action, never a role name.
- Roles are editable and admins may create new ones. The System Administrator
  and Access Administrator roles are locked: they cannot be edited or deleted.
  System Administrator holds every action outside Access & Identity, including
  actions added later.
- A Role's Access Summary is generated from its grid, so it cannot go stale.
  The admin-written purpose sits beside it and does not replace it.
- Role Grants are agency-wide. The grant row carries a nullable scope so a
  later decision can limit a grant to an agreement or contractor.
- Sign-in is gated in Entra by "Assignment required" on the enterprise
  application and one OnBoard Users group. A signed-in person with no Role
  Grant sees a No access page. Disabling an Entra account still ends all
  access.
- `System.Ingestion` stays an Entra app role. Workload identities have no
  person record, and a token claim is the right carrier for them.
- `GET /api/me/access` returns the caller's Effective Access; the console
  gates routes, navigation and controls from it and keeps no role lists.

**Consequences:** adding a module or action is a code change plus a migration
that decides which seeded Roles receive it; there is no Entra step. A Privileged
Access Change now covers granting or revoking a locked Role and any edit that
adds an Access & Identity action to a Role, and it still needs a second
Access Administrator. At least one active Access Administrator must remain.
Anyone who can write the grants tables can grant authority, so those tables
are written only by the access API and every change is audited. Entra Access
Reviews and PIM no longer see OnBoard's human roles; the access review lives
in OnBoard's own audit and expiry records.
