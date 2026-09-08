{{/* Fully-qualified image ref for a service, honouring the registry prefix. */}}
{{- define "eventide.image" -}}
{{- $reg := .root.Values.imageRegistry -}}
{{- $repo := .svc.image.repository -}}
{{- $tag := .svc.image.tag | default "latest" -}}
{{- if $reg -}}{{ $reg }}/{{ $repo }}:{{ $tag }}{{- else -}}{{ $repo }}:{{ $tag }}{{- end -}}
{{- end -}}

{{/* Standard labels. */}}
{{- define "eventide.labels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/part-of: eventide
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
{{- end -}}
