import { api } from './api';

export interface StaffMember {
  id: string;
  full_name: string | null;
}

export async function fetchStaffMembers(): Promise<StaffMember[]> {
  const { data, error } = await api.from('profiles')
    .select('id, full_name').in('role', ['tailor', 'admin']).order('full_name');
  if (error) throw error;
  return (data || []) as StaffMember[];
}
