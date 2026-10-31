## REGLA DE NEGOCIO DEFINITIVA DE FLOWww — VALIDADA POR EL RESPONSABLE DEL SISTEMA

**ATENCIÓN: Las siguientes reglas de negocio ya están confirmadas. NO volver a tratarlas como hipótesis ni solicitar auditorías adicionales para demostrar que FLOWww funciona así.**

### 1. Funcionamiento obligatorio de las modificaciones

En FLOWww:

- **Cuando se modifica la fecha u horario de una cita, SIEMPRE se genera un registro histórico.**
- **Cuando se modifican los servicios programados de una cita, SIEMPRE se genera un registro histórico.**
- La reserva vigente conserva su `DiaryGID` original y se actualiza con los nuevos datos.
- La versión anterior queda conservada como registro histórico, identificable mediante `DiaryGDelayed = -1` y `DiaryGDelayedID` apuntando al identificador de la cita vigente.
- Cada versión histórica conserva los detalles de servicios correspondientes a esa versión mediante `diary_det`.

Estas reglas constituyen el comportamiento funcional establecido de FLOWww y deben tomarse como requisitos de negocio.

### 2. Consecuencia para las predicciones

**Una reserva activa sin registros históricos de modificación asociados se considera una reserva que no ha cambiado su fecha ni sus servicios desde su creación.**

Por tanto, sus servicios programados actuales pueden utilizarse como los originalmente reservados, bajo la regla de negocio `FLOWWW_UNCHANGED_BOOKING`.

NO se debe exigir un timestamp individual en cada fila de `diary_det`, porque FLOWww utiliza el mecanismo de copias históricas para representar estas modificaciones.

NO se debe seguir bloqueando indiscriminadamente las reservas mediante `SCHEDULED_SERVICES_NOT_POINT_IN_TIME`.

Las reservas con modificaciones deben tratarse de manera diferenciada y podrán reconstruirse utilizando sus versiones históricas.

### 3. Ejemplos reales establecidos

**Reserva `1281790`:**

- No tiene registros históricos de modificación asociados.
- Tiene tres servicios programados.
- Su catálogo está correctamente resuelto.
- Según la regla de FLOWww, sus servicios no han sido modificados desde la creación.
- Debe poder avanzar a la siguiente validación predictiva, sin el bloqueo global de servicios.

**Reserva `834529`:**

- Conserva una versión histórica `834532`.
- La versión histórica tiene una fecha diferente.
- Ambas versiones conservan dos servicios con igual composición.
- Demuestra cómo una modificación de fecha genera una copia histórica, aunque los servicios no cambien.
- No debe confundirse una modificación histórica con una cancelación o una inasistencia.

### 4. Instrucción obligatoria para la implementación

Implementa la corrección en Node.js asumiendo estas reglas como requisitos funcionales confirmados.

**NO hagas lo siguiente:**

- Solicitar nuevas confirmaciones de estas reglas.
- Bloquear la implementación alegando que aún debemos demostrar que FLOWww genera copias.
- Exigir nuevos timestamps de servicios que FLOWww no proporciona.
- Proponer snapshots adicionales como requisito para las reservas que no han sido modificadas.
- Volver a introducir `ProductStamp` como criterio temporal bloqueante.
- Cambiar los modelos Python o las 19 variables para resolver este problema de Node.js.

**SÍ debes hacer lo siguiente:**

1. Implementar la identificación de modificaciones mediante `DiaryGDelayed` y `DiaryGDelayedID`.
2. Habilitar el uso de servicios originales en reservas que no presentan modificaciones.
3. Mantener una categoría de evidencia explícita y auditable para este caso.
4. Conservar las validaciones independientes de cancelaciones, bloqueos, borradores, historial del cliente y consistencia del catálogo.
5. Adaptar la evaluación individual, el listado y las pruebas automatizadas.
6. Ejecutar una predicción real con la reserva `1281790` utilizando Random Forest y XGBoost.
7. Verificar que el resultado se almacene correctamente y pueda consultarse desde la API.

Las pruebas deben comprobar que **nuestro código respeta las reglas de FLOWww**, no cuestionar indefinidamente las reglas de negocio ya proporcionadas.

**PRIORIDAD:** implementar la corrección funcional y demostrar el recorrido completo Node.js → Python → persistencia → respuesta API con una reserva real.

No detener el desarrollo con nuevas propuestas de investigación sobre el mecanismo de copias históricas.
