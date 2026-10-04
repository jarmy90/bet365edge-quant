# Databento detenido

**No usar Databento. No se han hecho llamadas ni descargas.** La petición actual excluye servicios de pago y establece coste total 0 €. El antiguo `nq_databento_pipeline.py` permanece como artefacto histórico pero no debe ejecutarse; no se requieren API keys.

Ruta activa elegida por prioridad: export de MT5 IC Markets si el usuario tiene el historial; de lo contrario muestra pública gratuita vía dukascopy-node, con instrumento CFD identificado y sus límites de equivalencia documentados. HistData M1 solo para filtro geométrico.
