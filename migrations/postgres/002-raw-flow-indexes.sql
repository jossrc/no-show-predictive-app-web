-- Índices de raw_flow (documentacion_bd_flow_tesis.md, sección 41).
-- Se aplican al terminar la carga completa.

CREATE INDEX IF NOT EXISTS idx_raw_clients_clinic ON raw_flow.clients ("ClientClinicID");
CREATE INDEX IF NOT EXISTS idx_raw_clients_stamp ON raw_flow.clients ("ClientStamp");
CREATE INDEX IF NOT EXISTS idx_raw_clients_referer ON raw_flow.clients ("ClientRefererID");

CREATE INDEX IF NOT EXISTS idx_raw_diary_client ON raw_flow.diary_gen ("DiaryGClientID");
CREATE INDEX IF NOT EXISTS idx_raw_diary_clinic_date ON raw_flow.diary_gen ("DiaryGClinicID", "DiaryGDate");
CREATE INDEX IF NOT EXISTS idx_raw_diary_laser ON raw_flow.diary_gen ("DiaryGLaserGID");
CREATE INDEX IF NOT EXISTS idx_raw_diary_delayed_id ON raw_flow.diary_gen ("DiaryGDelayedID");
CREATE INDEX IF NOT EXISTS idx_raw_diary_tracking_stamp ON raw_flow.diary_gen ("DiaryGTrackingStamp");
CREATE INDEX IF NOT EXISTS idx_raw_diary_stamp ON raw_flow.diary_gen ("DiaryGStamp");
CREATE INDEX IF NOT EXISTS idx_raw_diary_outcome_flags
    ON raw_flow.diary_gen ("DiaryGLocked", "DiaryGDelayed", "DiaryGNotAttended", "DiaryGInvisible");

CREATE INDEX IF NOT EXISTS idx_raw_diary_det_gid ON raw_flow.diary_det ("DiaryGID");
CREATE INDEX IF NOT EXISTS idx_raw_diary_det_zone ON raw_flow.diary_det ("DiaryZoneID");
CREATE INDEX IF NOT EXISTS idx_raw_diary_det_voucher ON raw_flow.diary_det ("DiaryVoucherID");

CREATE INDEX IF NOT EXISTS idx_raw_laser_client_date ON raw_flow.laser_gen ("LaserGClientID", "LaserGDate");
CREATE INDEX IF NOT EXISTS idx_raw_laser_clinic_date ON raw_flow.laser_gen ("LaserGClinicID", "LaserGDate");
CREATE INDEX IF NOT EXISTS idx_raw_laser_ticket ON raw_flow.laser_gen ("LaserGTicketGID");
CREATE INDEX IF NOT EXISTS idx_raw_laser_stamp ON raw_flow.laser_gen ("LaserGStamp");

CREATE INDEX IF NOT EXISTS idx_raw_laser_det_gid ON raw_flow.laser_det ("LaserGID");
CREATE INDEX IF NOT EXISTS idx_raw_laser_det_zone ON raw_flow.laser_det ("LaserZoneID");

CREATE INDEX IF NOT EXISTS idx_raw_ticket_client ON raw_flow.tickets_gen ("TicketGClientID");
CREATE INDEX IF NOT EXISTS idx_raw_ticket_clinic_date ON raw_flow.tickets_gen ("TicketGClinicID", "TicketGDate");
CREATE INDEX IF NOT EXISTS idx_raw_ticket_closed ON raw_flow.tickets_gen ("TicketGClosed");

CREATE INDEX IF NOT EXISTS idx_raw_ticket_det_gid ON raw_flow.tickets_det ("TicketGID");
CREATE INDEX IF NOT EXISTS idx_raw_ticket_det_product ON raw_flow.tickets_det ("TicketProductID");
CREATE INDEX IF NOT EXISTS idx_raw_ticket_det_voucher ON raw_flow.tickets_det ("TicketPayVoucherID");
CREATE INDEX IF NOT EXISTS idx_raw_ticket_det_laser ON raw_flow.tickets_det ("TicketLaserGID");
CREATE INDEX IF NOT EXISTS idx_raw_ticket_det_stamp ON raw_flow.tickets_det ("TicketTimeStamp");

CREATE INDEX IF NOT EXISTS idx_raw_voucher_client ON raw_flow.vouchers ("VoucherClientID");
CREATE INDEX IF NOT EXISTS idx_raw_voucher_product ON raw_flow.vouchers ("VoucherProductID");
CREATE INDEX IF NOT EXISTS idx_raw_voucher_available
    ON raw_flow.vouchers ("VoucherClientID", "VoucherProductID", "VoucherAvailable");
CREATE INDEX IF NOT EXISTS idx_raw_voucher_expiry ON raw_flow.vouchers ("VoucherExpiryDate");

CREATE INDEX IF NOT EXISTS idx_raw_product_parent ON raw_flow.x_config_products_det ("ProductParentID");
CREATE INDEX IF NOT EXISTS idx_raw_product_type ON raw_flow.x_config_products_det ("ProductType");
CREATE INDEX IF NOT EXISTS idx_raw_product_zone_code ON raw_flow.x_config_products_det ("ProductZoneCode");
CREATE INDEX IF NOT EXISTS idx_raw_product_voucher_pid ON raw_flow.x_config_products_det ("ProductVoucherPID");
CREATE INDEX IF NOT EXISTS idx_raw_product_stamp ON raw_flow.x_config_products_det ("ProductStamp");

CREATE INDEX IF NOT EXISTS idx_raw_clinic_status
    ON raw_flow.x_config_clinics ("ClinicDisabled", "ClinicTest", "ClinicStopped", "ClinicStandBy");
CREATE INDEX IF NOT EXISTS idx_raw_clinic_stamp ON raw_flow.x_config_clinics ("ClinicStamp");

CREATE INDEX IF NOT EXISTS idx_raw_workplace_user ON raw_flow.__x_config_workplaces_view ("WorkPlaceUserID");
