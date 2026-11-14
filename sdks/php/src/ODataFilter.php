<?php

declare(strict_types=1);

namespace BCStudio;

/**
 * A single OData filter expression.
 *
 * Supported ops: eq, ne, gt, ge, lt, le, contains, startswith, endswith
 *
 * Datetimes are auto-normalised (milliseconds stripped) because BC
 * silently returns all records when ms are present in $filter.
 */
class ODataFilter
{
    public function __construct(
        private readonly string $field,
        private readonly string $op,
        private readonly mixed  $value,
    ) {}

    public function build(): string
    {
        $v = $this->value;

        if (is_string($v)) {
            // Datetime — strip milliseconds
            if (preg_match('/^\d{4}-\d{2}-\d{2}T/', $v)) {
                $v = BCClient::normalizeFilterDate($v);
                return "{$this->field} {$this->op} $v";
            }
            // Boolean strings
            if (in_array(strtolower($v), ['true', 'false'], true)) {
                return "{$this->field} {$this->op} " . strtolower($v);
            }
            // Function calls
            if (in_array($this->op, ['contains', 'startswith', 'endswith'], true)) {
                return "{$this->op}({$this->field},'$v')";
            }
            return "{$this->field} {$this->op} '$v'";
        }

        if (is_bool($v))  return "{$this->field} {$this->op} " . ($v ? 'true' : 'false');
        if (is_null($v))  return "{$this->field} {$this->op} null";

        return "{$this->field} {$this->op} $v";
    }
}
