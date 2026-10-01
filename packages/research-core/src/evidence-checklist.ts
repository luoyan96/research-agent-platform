import { EvidenceChecklist } from '@research-agent-platform/contracts'
type Checklist = ReturnType<typeof EvidenceChecklist.parse>
export function renderChecklist(c:Checklist){return [c.title,...c.items.map(i=>`${i.requirement}: ${i.assessment}\n${i.citations.map(s=>`[${s.artifactId}] ${s.quote}`).join('\n')}\n${i.gap??''}`),...c.limitations].join('\n\n')}
// This verifies quotation provenance, not scientific truth or entailment.
export function validateChecklist(value:unknown,texts:{artifactId:string;text:string}[]){
 const result=EvidenceChecklist.parse(value)
 for(const item of result.items){
  if(item.assessment==='supported_by_input'&&!item.citations.length)throw new Error('INVALID_MODEL_OUTPUT')
  if(item.assessment==='gap'&&!item.gap)throw new Error('INVALID_MODEL_OUTPUT')
  for(const cite of item.citations){const source=texts.find(t=>t.artifactId===cite.artifactId);if(!source||!source.text.includes(cite.quote))throw new Error('INVALID_MODEL_OUTPUT')}
 }
 if(renderChecklist(result).length>8000)throw new Error('OUTPUT_LIMIT')
 return result
}
