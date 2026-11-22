-- HTML制作依頼の手動審査状態を保存する
alter table public.mhn_private_comments
  add column if not exists html_review_status text not null default 'pending',
  add column if not exists html_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists html_reviewed_at timestamptz,
  add column if not exists html_review_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mhn_private_comments_html_review_status_check'
      and conrelid = 'public.mhn_private_comments'::regclass
  ) then
    alter table public.mhn_private_comments
      add constraint mhn_private_comments_html_review_status_check
      check (html_review_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

create index if not exists mhn_private_comments_html_review_status_idx
  on public.mhn_private_comments (html_review_status, submitted_at desc)
  where message like '[HTML制作依頼]%';

comment on column public.mhn_private_comments.html_review_status is
  'HTML制作依頼の管理者判断。approvedは依頼承認を意味し、自動公開の完了を意味しない。';
