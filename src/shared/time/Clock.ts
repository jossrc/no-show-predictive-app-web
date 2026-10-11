/** Reloj inyectable: la lógica de aplicación nunca lee la hora global directamente. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
