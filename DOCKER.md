# Docker para emede

## Contenedor

### Build e inicio

```bash
# Build e inicio con docker-compose
docker-compose up -d

# Solo build (sin iniciar)
docker-compose build
```

### Acceso

La aplicación estará disponible en `http://localhost:5178`

### Logs

```bash
docker-compose logs -f
```

### Detener

```bash
docker-compose down
```

### Reiniciar

```bash
docker-compose restart
```

### Estado del contenedor

```bash
docker-compose ps
```

## Volumen de datos

Los datos se persisten en el volumen `emede-data`:
- Proyectos
- Configuración
- API keys de Gemini
- Plantillas

Para hacer backup del volumen:

```bash
docker run --rm -v emede_data:/data -v $(pwd):/backup alpine tar czf /backup/emede-backup-$(date +%Y%m%d).tar.gz -C /data .
```

Para restaurar:

```bash
docker run --rm -v emede_data:/data -v $(pwd):/backup alpine tar xzf /backup/emede-backup-YYYYMMDD.tar.gz -C /data
```

## Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `HOST` | Interfaz donde escucha el servidor | `0.0.0.0` |
| `PORT` | Puerto donde escucha el servidor | `5178` |
| `EMEDE_DATA_DIR` | Directorio donde se guardan los datos | `/data/.emede` |

## Notas de seguridad

- El contenedor escucha en `0.0.0.0:5178` dentro del contenedor.
- La API solo acepta conexiones desde `localhost` o `127.0.0.1` (revisa `server/api.ts`).
- Las API keys de Gemini se guardan en `/data/.emede/emede.json` dentro del contenedor.
- Los datos persisten en el volumen `emede-data`.

## Actualización

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose down
docker-compose build
docker-compose up -d
```

## Debug

Entrar en el contenedor:

```bash
docker-compose exec emede sh
```

Verificar la API de salud:

```bash
curl http://localhost:5178/api/health
```

Verificar el archivo de datos:

```bash
docker-compose exec emede cat /data/.emede/emede.json
```
