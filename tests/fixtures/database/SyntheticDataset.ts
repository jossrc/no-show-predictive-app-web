import type pg from 'pg';

/**
 * Inserción de datos ESTRICTAMENTE SINTÉTICOS en la BD de prueba: IDs en rango 9xxxxxxxxxxxxx,
 * nombres artificiales, fechas inventadas. Los timestamps de FLOWww se escriben como hora de
 * pared de Lima (timestamp sin zona), igual que la réplica real.
 */
export interface SyntheticAppointment {
  id: string;
  clientId: string;
  clinicId: number;
  /** 'YYYY-MM-DD' local Lima. */
  date: string;
  /** 'HH:MM:SS' local Lima. */
  start: string;
  end: string | null;
  /** Hora de pared Lima 'YYYY-MM-DD HH:MM:SS' o null. */
  createdLocal: string | null;
  outcome: string;
  detail: string;
  fwa?: number;
  delayed?: number;
  delayedId?: string;
  tags?: string;
  stampLocal?: string | null;
}

export async function insertClinics(client: pg.Client, ids: readonly number[]): Promise<void> {
  for (const id of ids) {
    await client.query(
      `INSERT INTO raw_flow.x_config_clinics ("ClinicID", "ClinicName") VALUES ($1, $2)`,
      [id, `Sede sintética ${id}`],
    );
  }
}

export async function insertClient(
  client: pg.Client,
  input: { id: string; birthDate: string | null; sex: string; stampLocal: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO raw_flow.clients ("ClientID", "ClientName", "ClientSex", "ClientBirthDate", "ClientStamp")
     VALUES ($1, 'Cliente sintético', $2, $3, $4)`,
    [input.id, input.sex, input.birthDate, input.stampLocal],
  );
}

export async function insertProduct(
  client: pg.Client,
  input: {
    id: string;
    type: number;
    parentId?: string;
    evaluation?: number;
    stampLocal: string | null;
    bodyAreaProductId?: string | null;
    resolution?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO raw_flow.x_config_products_det ("ProductID", "ProductType", "ProductParentID", "ProductEvaluation", "ProductStamp")
     VALUES ($1, $2, $3, $4, $5)`,
    [input.id, input.type, input.parentId ?? '0', input.evaluation ?? 0, input.stampLocal],
  );
  if (input.resolution) {
    await client.query(
      `INSERT INTO analytics.product_catalog_resolution (product_id, product_type, product_parent_id, body_area_product_id, resolution_method)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.id,
        input.type,
        input.parentId ?? null,
        input.bodyAreaProductId ?? null,
        input.resolution,
      ],
    );
  }
}

export async function insertAppointment(client: pg.Client, a: SyntheticAppointment): Promise<void> {
  await client.query(
    `INSERT INTO raw_flow.diary_gen ("DiaryGID", "DiaryGClientID", "DiaryGClinicID", "DiaryGDate", "DiaryGStart",
       "DiaryGEnd", "DiaryGCreated", "DiaryGFWA", "DiaryGDelayed", "DiaryGDelayedID", "DiaryGTags", "DiaryGStamp")
     VALUES ($1, $2, $3, $4::date, $5::time, $6::time, $7::timestamp, $8, $9, $10, $11, $12::timestamp)`,
    [
      a.id,
      a.clientId,
      a.clinicId,
      a.date,
      a.start,
      a.end,
      a.createdLocal,
      a.fwa ?? 0,
      a.delayed ?? 0,
      a.delayedId ?? '0',
      a.tags ?? '',
      a.stampLocal ?? a.createdLocal,
    ],
  );
  await client.query(
    `INSERT INTO analytics.appointment_outcomes (appointment_id, client_id, clinic_id, appointment_at,
       created_at_source, outcome, classification_detail, outcome_rule_version, classification_cutoff_at)
     VALUES ($1, $2, $3, ($4::date + $5::time) AT TIME ZONE 'America/Lima',
       $6::timestamp AT TIME ZONE 'America/Lima', $7::analytics.appointment_outcome_enum,
       $8::analytics.appointment_detail_enum, 'FLOW_NO_SHOW_V1', '2026-10-08T01:58:00Z')`,
    [a.id, a.clientId, a.clinicId, a.date, a.start, a.createdLocal, a.outcome, a.detail],
  );
}

export async function insertScheduledService(
  client: pg.Client,
  input: {
    appointmentId: string;
    detailId: string;
    productId: string;
    productType: number | null;
    medical: boolean | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO raw_flow.diary_det ("DiaryID", "DiaryGID", "DiaryZoneID") VALUES ($1, $2, $3)`,
    [input.detailId, input.appointmentId, input.productId],
  );
  await client.query(
    `INSERT INTO analytics.appointment_services (appointment_id, service_phase, source_detail_id, product_id, product_type, is_medical_evaluation)
     VALUES ($1, 'SCHEDULED', $2, $3, $4, $5)`,
    [input.appointmentId, input.detailId, input.productId, input.productType, input.medical],
  );
}

export async function insertRescheduleEvent(
  client: pg.Client,
  input: { appointmentId: string; clientId: string; copyId: string; eventAtUtc: string },
): Promise<void> {
  await client.query(
    `INSERT INTO analytics.appointment_events (appointment_id, client_id, event_type, event_at, source_table, source_row_id, rule_version)
     VALUES ($1, $2, 'RESCHEDULED', $3::timestamptz, 'diary_gen', $4, 'FLOW_RESCHEDULE_HISTORY_V1_UNVERIFIED_TIME')`,
    [input.appointmentId, input.clientId, input.eventAtUtc, input.copyId],
  );
}

/** Fila del ETL 13 (historial acumulado). known_at en UTC ISO. */
export async function insertHistoryRow(
  client: pg.Client,
  input: {
    appointmentId: string;
    clientId: string;
    knownAtUtc: string;
    kind: 0 | 1;
    attended: number;
    noShow: number;
    lastAttendedUtc: string | null;
    lastNoShowUtc: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO analytics.ml_history_cumulative_v1 (appointment_id, client_id, known_at, event_kind,
       prior_including_event_attended, prior_including_event_no_show, last_attended_at, last_no_show_at)
     VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7::timestamptz, $8::timestamptz)`,
    [
      input.appointmentId,
      input.clientId,
      input.knownAtUtc,
      input.kind,
      input.attended,
      input.noShow,
      input.lastAttendedUtc,
      input.lastNoShowUtc,
    ],
  );
}
