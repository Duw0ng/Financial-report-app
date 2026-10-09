# Finanzas Privadas v0.3 — PWA Android y PC

Aplicación local-first para importar estados de cuenta bancarios y llevar finanzas mensuales desde Android.

## Bancos soportados
- **Brubank**: cuenta ARS + cuenta USD dentro del mismo estado de cuenta.
- **Naranja X**: cuenta en pesos + cuenta en dólares, incluyendo rendimientos, transferencias, pagos de tarjeta y compra de dólar oficial.

La app detecta automáticamente el banco al importar el PDF.

## Privacidad
- No usa backend ni base de datos remota.
- Los PDFs se leen en memoria en el navegador y no se suben a GitHub ni a un servidor propio.
- Los movimientos persistentes se guardan en IndexedDB dentro de una bóveda cifrada con AES-GCM.
- La clave se deriva localmente con PBKDF2-SHA256 (310.000 iteraciones).
- El backup `.finbackup` conserva la bóveda cifrada.
- CSV y XLSX son exportaciones sin cifrar: guárdalas con cuidado.
- Incluye `robots.txt` y `meta robots=noindex,nofollow,noarchive` para pedir a buscadores que no indexen la PWA.

## Funciones
- Importación automática de PDF Brubank y Naranja X.
- ARS y USD.
- Detección de débito/crédito y duplicados.
- Filtro por cuenta/banco y por moneda.
- Detección de transferencias internas entre cuentas para no inflar ingresos/gastos.
- Compras de dólar entre cuentas propias excluidas de los totales de consumo/ingreso.
- Clasificación automática por comercio/descripción.
- Categorías especiales para tarjeta y rendimientos.
- Reglas aprendidas al corregir categorías.
- Edición, agregado y borrado manual de movimientos.
- Resumen mensual, gastos por categoría y **saldo acumulado automáticamente al mes siguiente**.
- Disponible, ahorros y patrimonio separados para ARS y USD.
- Registro de depósitos a ahorros y retiros de ahorros sin inflar ingresos o gastos.
- Configuración del saldo inicial al comenzar un mes base y meta de ahorro mensual.
- Recalculo de meses futuros cuando editas un movimiento histórico.
- Exportaciones Excel con saldos iniciales y cierres de cada mes.
- Exportación CSV/XLSX.
- Backup/restauración cifrados.
- Bloqueo automático configurable.
- Instalable como PWA en Android.

## Publicación en GitHub Pages
1. Ir a `Settings → Pages`.
2. En `Build and deployment`, elegir **Deploy from a branch**.
3. Seleccionar `main` y carpeta `/ (root)`.
4. Guardar.

La URL será `https://duw0ng.github.io/Financial-report-app/`.

Importante: `noindex` reduce la posibilidad de aparecer en buscadores, pero no es control de acceso. Este repositorio actualmente es público, por lo que cualquiera que conozca su URL puede ver el código y abrir una copia vacía de la app. Los datos financieros no se guardan en el repositorio.

## Dependencias externas
PDF.js y SheetJS se descargan desde cdnjs al primer uso. Los PDFs nunca se envían al CDN; sólo se descarga el código JavaScript de las librerías. El service worker puede cachearlas después.

## Migración desde v0.2
La bóveda cifrada existente se abre sin borrarse. El saldo inicial comienza como **no confirmado**, por lo que se presenta una advertencia y los números de disponible son estimados hasta que completes los saldos reales en Ajustes → Saldo inicial y ahorros. El mes base define desde cuándo se suman movimientos: los anteriores quedan fuera del cálculo para no contabilizarlos dos veces (se te advierte de ello).

El tipo **Ahorrar** reserva dinero: disminuye disponible, aumenta ahorros. **Retirar ahorros** hace lo contrario. No son ingresos ni gastos. Si una transferencia ya fue importada en un estado de cuenta, edita ese movimiento para marcarlo como ahorro y evita registrar un segundo movimiento manual. En transferencias entre cuentas propias de la misma moneda, ambas caras se excluyen; para compraventa de divisas marcada como interna se actualizan los saldos en cada moneda sin computarlas como consumo o ingreso.

### Nota sobre saldos
El disponible se calcula a partir de los movimientos que registra la app, no consulta el banco en tiempo real. Sin saldo inicial confirmado o si faltan movimientos, es una estimación. ARS y USD se muestran separados: no se suman monedas diferentes sin un tipo de cambio.

### Pruebas recomendadas
1. Hacer backup cifrado antes de cambiar de versión.
2. Configurar saldo disponible y ahorros al comienzo del primer mes importado.
3. Agregar depósito a ahorros, después un retiro; comprobar que no cambian ingresos/gastos ni patrimonio total.
4. Cambiar un gasto del mes anterior y verificar el efecto en el saldo del mes siguiente.
5. Importar un PDF ya cargado y verificar que no se dupliquen los movimientos.
6. Abrir un mes sin movimientos y confirmar que arrastra el saldo anterior.

## Cotización de dólar y compra de USD (v0.4)
- Visualización del dólar **Oficial / MEP-Bolsa / Blue**, precio de **venta** para comprar y precio de **compra** para vender, desde [DolarAPI](https://dolarapi.com/docs/argentina/operations/get-dolar-oficial). Consulta inicial al desbloquear, botón de refrescar y renovación aproximada cada 10 minutos.
- Al registrar **compra de USD** se crean dos apuntes relacionados: **sale el importe ARS efectivamente pagado** y **entran los USD realmente recibidos**. No son ingresos ni gastos, y pasan al mes siguiente a sus respectivos saldos disponibles.
- El importe en pesos se sugiere desde la cotización de venta, pero puede editarse si el banco aplica un precio distinto, comisiones o impuestos dentro del importe total pagado. Se conserva tanto la cotización de referencia como el tipo efectivo de la operación.
- Si importas un PDF que coincida con fecha, importe, moneda y dirección de apuntes manuales de cambio, los reemplaza por los del banco (en lugar de duplicarlos). También puede aprovechar un apunte bancario ya cargado.
- Muestra un total orientativo en ARS: ARS acumulados + USD acumulados multiplicados por la cotización de **compra**, la usada para valorar una posible venta. Este estimado solo se muestra para el mes actual con cotización suficientemente reciente; no altera el historial.
- Cada movimiento conserva el importe y tipo de cambio al registrar la compra. **El precio de hoy nunca reescribe transacciones históricas.**
- La cotización procede de una API de terceros, no de Brubank ni de Naranja X, y puede estar desactualizada fuera del horario de mercado. Si no funciona la red, puedes introducir una cotización manual.
- Por privacidad, solo se consulta la cotización pública desde el navegador. No se envían los saldos, los movimientos, el monto a cambiar ni la clave de la bóveda al proveedor.
- Antes de registrar compras, confirmar saldo inicial en Ajustes y realizar un backup cifrado. En compras de fechas anteriores usar importes verdaderos y no el precio de hoy.

## Saldos del PDF y ajustes opcionales (v0.5)
- El botón **⚙ Ajustes** aparece también en la cabecera de escritorio.
- El cálculo intenta reconstruir automáticamente el saldo inicial de cada banco y moneda usando `Saldo` de los movimientos importados (Brubank y Naranja X). Cada serie bancaria se valida contra sus movimientos; si no concilia, conserva un saldo **estimado** y no inventa un saldo de partida.
- **No es necesario introducir manualmente un saldo inicial para usar la app.** En el panel se muestra si los saldos provienen de los PDF, de una configuración manual, o solo de los movimientos registrados.
- Se eliminó la advertencia amarilla que exigía configurar un valor al trabajar con saldos estimados. Permanecen alertas pertinentes si una configuración manual deja movimientos fuera de su mes base.
- La compra de USD se puede registrar con saldo estimado previa confirmación; nunca se bloquea por no haber configurado la apertura.
- El saldo inicial manual sigue siendo opcional, para casos de PDF incompleto, cuentas no importadas, efectivo fuera del banco u otros ajustes. El botón **Volver al cálculo automático del PDF** desactiva ese ajuste sin borrar movimientos.
- Los saldos de PDF corresponden a fechas de sus extractos: no son una conexión bancaria ni una garantía de disponibilidad actual; importar los extractos recientes mejora la precisión.
