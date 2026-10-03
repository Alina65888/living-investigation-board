<?php
// Every /api/* request is routed here by ../.htaccess.
if (PHP_VERSION_ID < 80100) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['team' => true, 'serverError' => 'На хостинге включён PHP ' . PHP_VERSION . '. Выберите в панели хостинга PHP 8.1 или новее для этого сайта.'], JSON_UNESCAPED_UNICODE);
    exit;
}
require __DIR__ . '/lib.php';
run();
