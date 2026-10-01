# Finanzas Privadas v0.2 — PWA Android

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
- Resumen mensual y gastos por categoría.
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
