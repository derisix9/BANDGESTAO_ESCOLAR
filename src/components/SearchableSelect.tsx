import React, { useState, useRef, useEffect, useMemo } from 'react';

export interface SearchableOption {
  value: string;
  label: string;
  sublabel?: string;
  badge?: string;
  avatar?: string;
  icon?: string;
}

interface SearchableSelectProps {
  id?: string;
  label?: string;
  options: SearchableOption[];
  value: string;
  onChange: (value: string, option?: SearchableOption) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  allowCustom?: boolean;
  helperText?: string;
  emptyMessage?: string;
  className?: string;
  /** Limita quantas opções são desenhadas na lista (útil com milhares de registos). A pesquisa continua a abranger todas. */
  maxResults?: number;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  id,
  label,
  options,
  value,
  onChange,
  placeholder = 'Selecione ou pesquise...',
  required = false,
  disabled = false,
  allowCustom = false,
  helperText,
  emptyMessage = 'Nenhum resultado encontrado',
  className = '',
  maxResults
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Find the selected option if it exists
  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  // Sync query when value changes from outside
  useEffect(() => {
    if (selectedOption) {
      setQuery(selectedOption.label);
    } else if (allowCustom && value) {
      setQuery(value);
    } else if (!value) {
      setQuery('');
    }
  }, [value, selectedOption, allowCustom]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        // If query was modified without picking, reset to selected label or custom
        if (selectedOption) {
          setQuery(selectedOption.label);
        } else if (allowCustom && value) {
          setQuery(value);
        } else if (!value) {
          setQuery('');
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedOption, value, allowCustom]);

  // Filter options based on query
  const filteredOptions = useMemo(() => {
    if (!query.trim()) return options;
    const cleanQuery = query.toLowerCase().trim();
    return options.filter((opt) => {
      const matchLabel = opt.label.toLowerCase().includes(cleanQuery);
      const matchSub = opt.sublabel && opt.sublabel.toLowerCase().includes(cleanQuery);
      const matchBadge = opt.badge && opt.badge.toLowerCase().includes(cleanQuery);
      return matchLabel || matchSub || matchBadge;
    });
  }, [options, query]);

  const visibleOptions = useMemo(
    () => (maxResults && filteredOptions.length > maxResults ? filteredOptions.slice(0, maxResults) : filteredOptions),
    [filteredOptions, maxResults]
  );

  const handleSelectOption = (opt: SearchableOption) => {
    onChange(opt.value, opt);
    setQuery(opt.label);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setQuery('');
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setIsOpen(true);
    if (allowCustom) {
      onChange(val);
    }
  };

  return (
    <div className={`relative flex flex-col ${className}`} ref={containerRef}>
      {label && (
        <label
          htmlFor={id}
          className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center justify-between"
        >
          <span>
            {label} {required && <span className="text-red-600">*</span>}
          </span>
          {options.length > 0 && (
            <span className="text-[10px] text-slate-400 font-normal lowercase">
              ({options.length} disponíveis)
            </span>
          )}
        </label>
      )}

      <div className="relative">
        <div
          data-searchable-select="box"
          className={`flex items-center w-full h-10 px-3 py-0 border rounded-none text-sm text-white transition-all shadow-none ${
            disabled
              ? 'bg-[#12498a] border-[#12498a] cursor-not-allowed opacity-70'
              : isOpen
              ? 'bg-[#12498a] border-[#0b3563] ring-2 ring-[#12498a]/30'
              : 'bg-[#12498a] border-[#12498a] hover:bg-[#0f3f78]'
          }`}
        >
          {selectedOption?.avatar ? (
            <img
              src={selectedOption.avatar}
              alt=""
              className="w-5 h-5 rounded-none object-cover mr-2 shrink-0 border border-slate-300"
              referrerPolicy="no-referrer"
            />
          ) : selectedOption?.icon ? (
            <span className="material-symbols-outlined text-[18px] text-white mr-2 shrink-0">
              {selectedOption.icon}
            </span>
          ) : (
            <span className="material-symbols-outlined text-[18px] text-white mr-2 shrink-0">
              search
            </span>
          )}

          <input
            ref={inputRef}
            id={id}
            type="text"
            disabled={disabled}
            value={query}
            onChange={handleInputChange}
            onFocus={() => {
              if (!disabled) setIsOpen(true);
            }}
            placeholder={placeholder}
            className="w-full bg-transparent text-white text-xs focus:outline-none placeholder-white/75"
            autoComplete="off"
          />

          <div className="flex items-center gap-1 shrink-0 ml-1">
            {(value || query) && !disabled && (
              <button
                type="button"
                onClick={handleClear}
                className="p-1 text-white/80 hover:text-white rounded-none hover:bg-white/15 transition-colors"
                title="Limpar seleção"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                if (!disabled) {
                  setIsOpen(!isOpen);
                  if (!isOpen && inputRef.current) inputRef.current.focus();
                }
              }}
              className="p-1 text-white/80 hover:text-white transition-colors"
            >
              <span
                className={`material-symbols-outlined text-[18px] text-white transition-transform duration-200 ${
                  isOpen ? 'rotate-180' : ''
                }`}
              >
                expand_more
              </span>
            </button>
          </div>
        </div>

        {/* Dropdown Menu */}
        {isOpen && !disabled && (
          <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-400 rounded-none shadow-xl max-h-72 overflow-y-auto divide-y divide-slate-200 animate-in fade-in zoom-in-95 duration-100">
            {visibleOptions.length > 0 ? (
              visibleOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelectOption(opt)}
                    className={`w-full text-left px-3 py-2.5 text-sm flex items-center justify-between gap-2 transition-colors cursor-pointer rounded-none ${
                      isSelected
                        ? 'bg-[#0b1f3a]/10 text-[#0b1f3a] font-bold'
                        : 'hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {opt.avatar ? (
                        <img
                          src={opt.avatar}
                          alt=""
                          className="w-6 h-6 rounded-none object-cover shrink-0 border border-slate-300"
                          referrerPolicy="no-referrer"
                        />
                      ) : opt.icon ? (
                        <span className="material-symbols-outlined text-[18px] text-[#0b1f3a] shrink-0">
                          {opt.icon}
                        </span>
                      ) : null}
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{opt.label}</span>
                        {opt.sublabel && (
                          <span className="text-[10px] text-slate-400 font-normal truncate">
                            {opt.sublabel}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {opt.badge && (
                        <span className="px-2 py-0.5 rounded-none bg-slate-100 text-slate-600 text-[10px] font-mono font-bold border border-slate-300">
                          {opt.badge}
                        </span>
                      )}
                      {isSelected && (
                        <span className="material-symbols-outlined text-[16px] text-[#0b1f3a]">
                          check
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="p-4 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-1">
                <span className="material-symbols-outlined text-[20px] text-slate-300">
                  search_off
                </span>
                <span>{emptyMessage}</span>
                {allowCustom && query.trim() && (
                  <button
                    type="button"
                    onClick={() => {
                      onChange(query);
                      setIsOpen(false);
                    }}
                    className="mt-2 text-xs font-bold text-[#0b1f3a] hover:underline"
                  >
                    Usar "{query}"
                  </button>
                )}
              </div>
            )}
            {maxResults !== undefined && filteredOptions.length > visibleOptions.length && (
              <div className="px-3 py-2 text-center text-[10px] text-slate-500 bg-slate-50">
                A mostrar {visibleOptions.length} de {filteredOptions.length} — escreva para refinar a pesquisa
              </div>
            )}
          </div>
        )}
      </div>

      {false && helperText && (
        <span className="text-[10px] text-slate-400 mt-1 block">{helperText}</span>
      )}
    </div>
  );
};
