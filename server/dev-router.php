<?php
// Local preview without Apache: php -S 127.0.0.1:8788 -t ../docs dev-router.php
// Serves ../docs as the site and sends /api/* to the PHP API, like .htaccess does on the hosting.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/api/')) { require __DIR__ . '/public/api/index.php'; return true; }
return false;
