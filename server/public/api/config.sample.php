<?php
// Copy to config.php (the GitHub deploy writes it for you) and fill in admin_email.
return [
    // Only this address can create the very first (administrator) account.
    'admin_email' => '',

    // SQLite needs no setup: the database file is created automatically.
    'db' => ['driver' => 'sqlite'],
    // MySQL instead (create the database in the hosting panel first):
    // 'db' => ['driver' => 'mysql', 'host' => 'localhost', 'name' => 'u1234567_hq', 'user' => 'u1234567_hq', 'password' => '...'],

    // Where the database and attached files live. Empty = a folder next to the site folder (~/www/living-hq-data).
    'data_dir' => '',
];
