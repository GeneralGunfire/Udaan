export type TemplateOwner = 'school' | 'work'

export interface DocumentTemplate {
  id: string
  owner: TemplateOwner
  category: string
  name: string
  description: string
  /** Raw body with `{{placeholder}}` tokens — consuming feature fills these in. */
  body: string
  createdAt: string
}
