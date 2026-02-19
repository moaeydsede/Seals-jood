export const PERMS = {
  invoices_view: 'عرض الفواتير',
  invoices_create: 'إنشاء فواتير',
  invoices_print: 'طباعة فواتير',
  returns_view: 'عرض المرتجعات',
  returns_create: 'إنشاء مرتجع',
  payments_view: 'عرض الدفعات',
  payments_create: 'إنشاء دفعات',
  payments_print: 'طباعة سند قبض',
  customers_view: 'عرض العملاء',
  customers_manage: 'إدارة العملاء',
  products_view: 'عرض الأصناف',
  products_manage: 'إدارة الأصناف',
  reports_view: 'عرض التقارير',
  reports_export: 'تصدير التقارير',
  audit_view: 'عرض سجل العمليات',
  users_manage: 'إدارة المستخدمين',
  company_manage: 'بيانات الشركة'
};

export function hasPerm(me, key){
  if(!me) return false;
  if(me.role === 'admin') return true;
  return !!(me.permissions && me.permissions[key]);
}
