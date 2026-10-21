create policy "Anyone uploads payment proofs" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'payment-proofs' and name ~ '^proofs/[A-Za-z0-9\-]+\.(png|jpg|jpeg|webp)$');
create policy "Admins read payment proofs" on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and public.has_role(auth.uid(), 'admin'));