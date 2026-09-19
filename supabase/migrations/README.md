# Supabase migrations

The production Supabase project already contains the initial MHN revenue schema and the following migrations:

- initial_mhn_revenue_schema
- lock_down_public_functions
- revoke_public_function_execute
- add_revenue_access_grants
- add_aal2_check

The Edge Functions are deployed directly to the MHN Supabase project:

- issue-revenue-grant
- revoke-revenue-grant
- revenue-summary
