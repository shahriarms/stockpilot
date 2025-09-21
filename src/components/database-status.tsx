
'use client';

import { useState } from 'react';
import { useAppData } from '@/hooks/use-app-data';
import { Loader2 } from 'lucide-react';
import { DatabaseInfoDialog } from './database-info-dialog';

export function DatabaseStatus() {
  const { isDbConnected, isAppDataLoading } = useAppData();
  const [isDialogOpen, setDialogOpen] = useState(false);

  if (isAppDataLoading) {
    return (
      <div className="flex items-center justify-center p-2 rounded-md w-[90px] h-9">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setDialogOpen(true)}
        className="flex items-center justify-center gap-2 p-2 rounded-md border bg-background text-foreground text-sm shadow-inner w-full hover:bg-muted transition-colors"
      >
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            isDbConnected ? 'bg-green-500' : 'bg-yellow-500'
          }`}
        />
        <span className="font-mono text-xs font-semibold">
          {isDbConnected ? 'Online' : 'Local'}
        </span>
      </button>
      <DatabaseInfoDialog open={isDialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
