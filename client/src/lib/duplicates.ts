/** "contacts.1.email" -> "Contact 2 email", "signatory.mobile" -> "Applicant mobile". */
export function describeDuplicateField(field: string): string {
  const [who, index, what] = field.split('.');
  if (who === 'signatory') return `Applicant ${index}`;
  if (who === 'contacts') return `Contact ${Number(index) + 1} ${what}`;
  return field;
}
