/** PostgREST caps responses; reports must not silently stop at the first page. */
export async function readAllRows<T = any>(query: any): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await query.range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message || 'Could not load all workshop records.');
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
