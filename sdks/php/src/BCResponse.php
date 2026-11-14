<?php
declare(strict_types=1);
namespace BCStudio;

class BCResponse
{
    public function __construct(
        public readonly bool    $success,
        public readonly int     $status,
        public readonly float   $durationMs,
        public readonly mixed   $data     = null,
        public readonly ?string $etag     = null,
        public readonly ?string $error    = null,
        public readonly mixed   $errorData = null,
    ) {}
}

class BCActionResponse
{
    public function __construct(
        public readonly bool    $success,
        public readonly int     $status,
        public readonly float   $durationMs,
        public readonly mixed   $data  = null,
        public readonly ?string $error = null,
    ) {}
}
