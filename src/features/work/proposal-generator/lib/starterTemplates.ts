import type { DocumentTemplate } from '@/integrations/template-library'

/**
 * Starter Work templates — original drafting scaffolds, not sourced from
 * any real legal document or template pack. These are structural starting
 * points for a freelancer/small business, not legal advice; every
 * template says so explicitly and should be reviewed by a lawyer before
 * real use, especially the NDA and contract.
 */

const NDA_BODY = `MUTUAL NON-DISCLOSURE AGREEMENT

This Agreement is entered into as of {{date}} between {{party_one}} ("Disclosing Party") and {{party_two}} ("Receiving Party"), collectively the "Parties."

1. PURPOSE
The Parties wish to explore {{purpose}} (the "Purpose") and, in connection with the Purpose, may disclose certain confidential information to one another.

2. CONFIDENTIAL INFORMATION
"Confidential Information" means any non-public information disclosed by either Party, whether written, oral, or in any other form, that is designated as confidential or that a reasonable person would understand to be confidential given the nature of the information and the circumstances of disclosure.

3. OBLIGATIONS
The Receiving Party agrees to:
  a. Use the Confidential Information solely for the Purpose;
  b. Not disclose the Confidential Information to any third party without prior written consent;
  c. Protect the Confidential Information using at least the same degree of care it uses for its own confidential information, and no less than reasonable care.

4. EXCLUSIONS
Confidential Information does not include information that: (a) is or becomes publicly available through no fault of the Receiving Party; (b) was already known to the Receiving Party prior to disclosure; (c) is independently developed without use of the Confidential Information; or (d) is disclosed with the prior written consent of the Disclosing Party.

5. TERM
This Agreement remains in effect for {{term_length}} from the date above, unless terminated earlier by mutual written agreement.

6. NO LICENSE
Nothing in this Agreement grants either Party any license or rights to the other's intellectual property beyond what's needed for the Purpose.

7. GOVERNING LAW
This Agreement is governed by the laws of {{governing_law}}.

Disclosing Party: {{party_one}}          Signature: ______________  Date: __________

Receiving Party: {{party_two}}          Signature: ______________  Date: __________

--
This is a drafting starting point, not legal advice. Have a lawyer review before signing.`

const SERVICE_CONTRACT_BODY = `SERVICE AGREEMENT

This Service Agreement ("Agreement") is entered into as of {{date}} between {{provider_name}} ("Provider") and {{client_name}} ("Client").

1. SERVICES
Provider agrees to perform the following services for Client: {{scope_of_work}}.

2. TIMELINE
Work will begin on {{start_date}} and is expected to be completed by {{end_date}}, subject to the terms of this Agreement.

3. PAYMENT
Client agrees to pay Provider {{payment_amount}} for the Services, payable as follows: {{payment_terms}}.

4. REVISIONS
This Agreement includes {{revision_count}} rounds of revisions to the deliverables described above. Additional revisions may be billed at {{additional_revision_rate}}.

5. OWNERSHIP
Upon full payment, ownership of the final deliverables transfers to Client. Provider retains the right to display the work in its portfolio unless Client requests otherwise in writing.

6. TERMINATION
Either Party may terminate this Agreement with {{notice_period}} written notice. Client agrees to pay for all work completed up to the termination date.

7. LIMITATION OF LIABILITY
Provider's total liability under this Agreement shall not exceed the total amount paid by Client under this Agreement.

8. GOVERNING LAW
This Agreement is governed by the laws of {{governing_law}}.

Provider: {{provider_name}}          Signature: ______________  Date: __________

Client: {{client_name}}          Signature: ______________  Date: __________

--
This is a drafting starting point, not legal advice. Have a lawyer review before signing, especially for larger engagements.`

const PROJECT_PROPOSAL_BODY = `PROJECT PROPOSAL

Prepared for: {{client_name}}
Prepared by: {{provider_name}}
Date: {{date}}

1. OVERVIEW
{{project_overview}}

2. GOALS
{{project_goals}}

3. SCOPE OF WORK
{{scope_of_work}}

4. TIMELINE
{{timeline}}

5. INVESTMENT
{{pricing_breakdown}}

Total estimated investment: {{total_price}}

6. WHY {{provider_name}}
{{why_us}}

7. NEXT STEPS
To move forward, {{next_steps}}.

We're looking forward to working with you.

{{provider_name}}
{{contact_info}}`

const QUOTE_BODY = `QUOTE

For: {{client_name}}
From: {{provider_name}}
Date: {{date}}
Quote valid until: {{valid_until}}

LINE ITEMS
{{line_items}}

Subtotal: {{subtotal}}
{{tax_line}}
Total: {{total}}

TERMS
{{payment_terms}}

This quote is an estimate based on the scope described above. Changes to scope may affect the final price.

{{provider_name}}
{{contact_info}}`

export const WORK_STARTER_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'work-nda-basic',
    owner: 'work',
    category: 'legal',
    name: 'Basic Mutual NDA',
    description: 'A simple two-way non-disclosure agreement for exploratory conversations.',
    body: NDA_BODY,
    createdAt: new Date(0).toISOString(),
  },
  {
    id: 'work-service-contract',
    owner: 'work',
    category: 'legal',
    name: 'Simple Service Contract',
    description: 'A freelance/small-business service agreement covering scope, payment, and ownership.',
    body: SERVICE_CONTRACT_BODY,
    createdAt: new Date(0).toISOString(),
  },
  {
    id: 'work-project-proposal',
    owner: 'work',
    category: 'proposal',
    name: 'Project Proposal',
    description: 'A client-facing proposal covering overview, scope, timeline, and pricing.',
    body: PROJECT_PROPOSAL_BODY,
    createdAt: new Date(0).toISOString(),
  },
  {
    id: 'work-quote',
    owner: 'work',
    category: 'proposal',
    name: 'Quote',
    description: 'A simple line-itemized price quote.',
    body: QUOTE_BODY,
    createdAt: new Date(0).toISOString(),
  },
]
