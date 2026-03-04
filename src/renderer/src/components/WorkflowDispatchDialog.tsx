import { useState } from 'react'
import { Play } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import type { WorkflowFile, WorkflowInput } from '@shared/types'

interface Props {
  workflow: WorkflowFile
  open: boolean
  onClose: () => void
  onRun: (inputs: Record<string, string>) => void
}

function InputField({
  name,
  def,
  value,
  onChange
}: {
  name: string
  def: WorkflowInput
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  if (def.type === 'choice' && def.options?.length) {
    return (
      <Select value={value || def.default || ''} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-sm">
          <SelectValue placeholder={def.default ?? 'Selecione...'} />
        </SelectTrigger>
        <SelectContent>
          {def.options.map((opt) => (
            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (def.type === 'boolean') {
    const checked = value !== '' ? value === 'true' : def.default === 'true'
    return (
      <Switch
        checked={checked}
        onCheckedChange={(v) => onChange(String(v))}
      />
    )
  }

  return (
    <Input
      placeholder={def.default ?? 'valor (opcional)'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 text-sm"
      type={def.type === 'number' ? 'number' : 'text'}
    />
  )
}

export function WorkflowDispatchDialog({ workflow, open, onClose, onRun }: Props): JSX.Element {
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [customKey, setCustomKey] = useState('')
  const [customValue, setCustomValue] = useState('')

  const setInput = (key: string, value: string) => {
    setInputs((prev) => ({ ...prev, [key]: value }))
  }

  const handleRun = () => {
    // Merge defined inputs with their defaults if not set
    const merged: Record<string, string> = {}
    if (workflow.inputs) {
      for (const [k, def] of Object.entries(workflow.inputs)) {
        const v = inputs[k]
        if (v !== undefined && v !== '') {
          merged[k] = v
        } else if (def.default !== undefined) {
          merged[k] = def.default
        }
      }
    }
    // Merge any custom inputs
    for (const [k, v] of Object.entries(inputs)) {
      if (!merged[k] && v) merged[k] = v
    }
    onRun(merged)
    onClose()
  }

  const handleAddCustom = () => {
    if (customKey.trim()) {
      setInput(customKey.trim(), customValue)
      setCustomKey('')
      setCustomValue('')
    }
  }

  const definedInputs = workflow.inputs ? Object.entries(workflow.inputs) : []
  const hasDefinedInputs = definedInputs.length > 0

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Executar: {workflow.name}</DialogTitle>
          <DialogDescription>
            Configure os parâmetros para esta execução manual
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Workflow info */}
          <div className="rounded-md border border-border p-3 space-y-1 text-sm">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">Workflow</p>
            <p className="font-mono text-xs">{workflow.file}</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {workflow.jobs.map((job) => (
                <span key={job} className="text-xs bg-muted px-1.5 py-0.5 rounded">{job}</span>
              ))}
            </div>
          </div>

          {/* Defined inputs from YAML */}
          {hasDefinedInputs ? (
            <div className="space-y-3">
              {definedInputs.map(([key, def]) => (
                <div key={key} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-mono">{key}</Label>
                    {def.required && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-[#f85149] border-[#f85149]/30">
                        obrigatório
                      </Badge>
                    )}
                    {def.default !== undefined && (
                      <span className="text-[10px] text-muted-foreground">
                        padrão: <code className="text-primary">{def.default}</code>
                      </span>
                    )}
                  </div>
                  {def.description && (
                    <p className="text-[11px] text-muted-foreground">{def.description}</p>
                  )}
                  <InputField
                    name={key}
                    def={def}
                    value={inputs[key] ?? ''}
                    onChange={(v) => setInput(key, v)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Adicione inputs opcionais (acessíveis via <code className="text-primary">{'${{ inputs.key }}'}</code>):
            </p>
          )}

          {/* Custom inputs (always shown) */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">
              {hasDefinedInputs ? 'Input adicional:' : 'Input customizado:'}
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="nome"
                className="h-8 text-sm w-32"
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
              />
              <Input
                placeholder="valor"
                className="h-8 text-sm"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
              />
              <Button size="sm" variant="outline" className="h-8" onClick={handleAddCustom}>+</Button>
            </div>
            {/* Show added custom inputs */}
            {Object.entries(inputs)
              .filter(([k]) => !workflow.inputs?.[k])
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 text-xs bg-muted/50 rounded px-2 py-1">
                  <span className="font-mono text-muted-foreground">{k}:</span>
                  <span className="flex-1 truncate">{v}</span>
                  <button
                    onClick={() => setInputs((p) => { const n = { ...p }; delete n[k]; return n })}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ×
                  </button>
                </div>
              ))
            }
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleRun}>
            <Play className="h-4 w-4" />
            Executar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
