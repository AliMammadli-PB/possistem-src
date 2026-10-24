import { RolePolicyEditor } from '../ui/RolePolicyEditor';
import { getRolePolicy, saveRolePolicy } from '../api';

/** The owner setting what their own staff may do, from anywhere. */
export function StaffRolesPage() {
  return <RolePolicyEditor load={getRolePolicy} save={saveRolePolicy} />;
}

export default StaffRolesPage;
