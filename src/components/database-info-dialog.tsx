
'use client';

import { useState, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { useAppData } from '@/hooks/use-app-data';
import { Database, Upload, Download, Loader2, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { exportAllData, importAllData } from '@/lib/actions/data-actions';
import { useUser } from '@/hooks/use-user';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

interface DatabaseInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DatabaseInfoDialog({ open, onOpenChange }: DatabaseInfoDialogProps) {
  const { isDbConnected } = useAppData();
  const { user } = useUser();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isConfirmImportOpen, setConfirmImportOpen] = useState(false);
  const [fileToImport, setFileToImport] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = user?.role === 'admin';

  const handleExport = async () => {
    if (!isAdmin) return;
    setIsExporting(true);
    try {
      const data = await exportAllData();
      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(data, null, 2))}`;
      const link = document.createElement("a");
      link.href = jsonString;
      link.download = `stockpilot-backup-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      toast({ title: "Export Successful", description: "All data has been downloaded." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Export Failed", description: error.message });
    } finally {
      setIsExporting(false);
    }
  };
  
  const handleImportClick = () => {
    if (!isAdmin) return;
    fileInputRef.current?.click();
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if(file.type === 'application/json'){
        setFileToImport(file);
        setConfirmImportOpen(true);
      } else {
        toast({ variant: 'destructive', title: 'Invalid File', description: 'Please select a valid .json backup file.'})
      }
    }
    // Reset file input to allow re-selection of the same file
    if(fileInputRef.current) fileInputRef.current.value = '';
  };
  
  const confirmImport = () => {
    if(!fileToImport || !isAdmin) return;
    setIsImporting(true);
    setConfirmImportOpen(false);
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const fileContent = e.target?.result;
            if (typeof fileContent !== 'string') {
                throw new Error("Failed to read file content.");
            }
            const data = JSON.parse(fileContent);
            
            const result = await importAllData(data);
            
            if(result.success){
                toast({ title: 'Import Successful', description: 'All data has been restored. The app will now reload.' });
                // Reload the page to reflect the new data state
                window.location.reload();
            } else {
                throw new Error(result.message);
            }
            
        } catch (error: any) {
             toast({ variant: 'destructive', title: 'Import Failed', description: error.message || 'The backup file may be corrupt or invalid.' });
        } finally {
            setIsImporting(false);
            setFileToImport(null);
        }
    }
    reader.readAsText(fileToImport);
  }

  const renderButton = (action: 'export' | 'import') => {
    const isDisabled = isExporting || isImporting || !isDbConnected || !isAdmin;
    const buttonContent = action === 'export' ? (
      <>
        {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Download className="mr-2 h-4 w-4" />}
        Export All Data
      </>
    ) : (
      <>
        {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Upload className="mr-2 h-4 w-4" />}
        Import Data
      </>
    );
    const buttonAction = action === 'export' ? handleExport : handleImportClick;
    const variant = action === 'export' ? 'default' : 'outline';

    if (!isAdmin) {
      return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    {/* The div wrapper is necessary for the tooltip to work on a disabled button */}
                    <div className='w-full'> 
                        <Button variant={variant as any} onClick={buttonAction} disabled={true} className="w-full">
                            {buttonContent}
                        </Button>
                    </div>
                </TooltipTrigger>
                <TooltipContent>
                    <p className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Admin access required.</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
      );
    }

    return (
        <Button variant={variant as any} onClick={buttonAction} disabled={isDisabled}>
            {buttonContent}
        </Button>
    );
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database /> Database Information
          </DialogTitle>
          <DialogDescription>
            View connection status and manage your application data.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
            <div className="flex items-center gap-4 p-4 rounded-lg bg-muted">
                <span className={`h-4 w-4 rounded-full ${isDbConnected ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <div>
                    <p className="font-semibold">Status: {isDbConnected ? 'Connected' : 'Local Mode'}</p>
                    <p className="text-sm text-muted-foreground">
                        Database Type: {isDbConnected ? 'PostgreSQL' : 'Not Connected'}
                    </p>
                </div>
            </div>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {renderButton('export')}
                 <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                    accept=".json"
                  />
                {renderButton('import')}
             </div>
             {!isDbConnected && (
                <p className="text-xs text-center text-muted-foreground">Data management is only available when connected to a database.</p>
             )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    
    <AlertDialog open={isConfirmImportOpen} onOpenChange={setConfirmImportOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="text-destructive"/> Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This is a **Full Restore** action. It cannot be undone. This will permanently **DELETE ALL** current data in the database and replace it with the data from your backup file.
              <br/><br/>
              Any data created after this backup was made will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmImport} className="bg-destructive hover:bg-destructive/90">
              Yes, delete all and import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
