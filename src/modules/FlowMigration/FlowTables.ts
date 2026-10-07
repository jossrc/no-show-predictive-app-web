export interface FlowTable {
  readonly name: string;
  readonly primaryKey: string;
}

export const flowTables: readonly FlowTable[] = [
  { name: 'x_config_clinics', primaryKey: 'ClinicID' },
  { name: 'x_config_products_det', primaryKey: 'ProductID' },
  { name: '__x_config_users_view', primaryKey: 'UserID' },
  { name: '__x_config_workplaces_view', primaryKey: 'WorkPlaceID' },
  { name: 'clients', primaryKey: 'ClientID' },
  { name: 'vouchers', primaryKey: 'VoucherID' },
  { name: 'diary_gen', primaryKey: 'DiaryGID' },
  { name: 'diary_det', primaryKey: 'DiaryID' },
  { name: 'laser_gen', primaryKey: 'LaserGID' },
  { name: 'laser_det', primaryKey: 'LaserID' },
  { name: 'tickets_gen', primaryKey: 'TicketGID' },
  { name: 'tickets_det', primaryKey: 'TicketID' },
];
