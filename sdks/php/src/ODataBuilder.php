<?php

declare(strict_types=1);

namespace BCStudio;

/**
 * OData v4 query builder for Business Central.
 *
 * Supports: $filter, $select, $top, $skip, $orderby, $expand, $count, $search, raw.
 * BC-specific: datetimes in $filter auto-normalised (milliseconds stripped).
 */
class ODataBuilder
{
    private ?int    $top     = null;
    private ?int    $skip    = null;
    private array   $select  = [];
    private array   $filters = [];
    private ?string $orderby = null;
    private array   $expand  = [];
    private bool    $count   = false;
    private ?string $search  = null;
    private ?string $raw     = null;

    public function top(int $n): static
    {
        $this->top = $n;
        return $this;
    }

    public function skip(int $n): static
    {
        $this->skip = $n;
        return $this;
    }

    public function select(string ...$fields): static
    {
        array_push($this->select, ...$fields);
        return $this;
    }

    /**
     * Add a $filter expression.
     *
     * @param string|ODataFilter|ODataFilter[] $filter
     */
    public function filter(string|ODataFilter|array $filter): static
    {
        if (is_string($filter)) {
            $this->filters[] = $filter;
        } elseif ($filter instanceof ODataFilter) {
            $this->filters[] = $filter->build();
        } elseif (is_array($filter)) {
            $parts = array_map(
                fn($f) => $f instanceof ODataFilter ? $f->build() : (string)$f,
                $filter
            );
            $this->filters[] = implode(' and ', $parts);
        }
        return $this;
    }

    public function orderby(string $field, string $dir = 'asc'): static
    {
        $this->orderby = "$field $dir";
        return $this;
    }

    public function expand(string ...$props): static
    {
        array_push($this->expand, ...$props);
        return $this;
    }

    public function count(bool $include = true): static
    {
        $this->count = $include;
        return $this;
    }

    public function search(string $term): static
    {
        $this->search = $term;
        return $this;
    }

    public function raw(string $qs): static
    {
        $this->raw = ltrim($qs, '&');
        return $this;
    }

    public function build(): string
    {
        $parts = [];

        if ($this->top  !== null) $parts[] = "\$top={$this->top}";
        if ($this->skip !== null) $parts[] = "\$skip={$this->skip}";
        if ($this->select)        $parts[] = "\$select=" . implode(',', $this->select);
        if ($this->filters) {
            $combined = implode(' and ', array_map(
                fn($f) => str_contains($f, ' or ') ? "($f)" : $f,
                $this->filters
            ));
            $parts[] = "\$filter=$combined";
        }
        if ($this->orderby)  $parts[] = "\$orderby={$this->orderby}";
        if ($this->expand)   $parts[] = "\$expand=" . implode(',', $this->expand);
        if ($this->count)    $parts[] = "\$count=true";
        if ($this->search)   $parts[] = "\$search={$this->search}";
        if ($this->raw)      $parts[] = $this->raw;

        return implode('&', $parts);
    }

    public static function fromArray(array $opts): static
    {
        $b = new static();
        if (isset($opts['top']))     $b->top((int)$opts['top']);
        if (isset($opts['skip']))    $b->skip((int)$opts['skip']);
        if (isset($opts['select']))  {
            $f = $opts['select'];
            $b->select(...(is_array($f) ? $f : [$f]));
        }
        if (isset($opts['filter']))  $b->filter($opts['filter']);
        if (isset($opts['orderby'])) {
            [$field, $dir] = explode(' ', $opts['orderby'] . ' asc') + [1 => 'asc'];
            $b->orderby($field, $dir);
        }
        if (isset($opts['expand'])) {
            $p = $opts['expand'];
            $b->expand(...(is_array($p) ? $p : [$p]));
        }
        if (!empty($opts['count']))  $b->count(true);
        if (isset($opts['search']))  $b->search($opts['search']);
        if (isset($opts['raw']))     $b->raw($opts['raw']);
        return $b;
    }
}
