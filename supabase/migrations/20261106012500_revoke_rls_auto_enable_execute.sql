-- rls_auto_enable() é função de event trigger (liga RLS em tabelas novas);
-- não precisa ser chamável pela API
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
