//! Refuse the Shell's permanent-delete fallback when this item's recycle bin is unavailable.
use std::cell::Cell;
use windows::{
    core::{implement, ComObject, Ref, Result, HRESULT, PCWSTR},
    Win32::{
        Foundation::E_ABORT,
        System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED},
        UI::Shell::*,
    },
};

#[implement(IFileOperationProgressSink)]
struct RecycleOnly {
    recycled: Cell<bool>,
    still_selected: Box<dyn Fn() -> bool>,
}

#[allow(non_snake_case)]
impl IFileOperationProgressSink_Impl for RecycleOnly_Impl {
    fn PreDeleteItem(&self, flags: u32, _: Ref<IShellItem>) -> Result<()> {
        if flags & TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32 == 0 || !(self.still_selected)() {
            return Err(E_ABORT.into());
        }
        Ok(())
    }
    fn PostDeleteItem(&self, _: u32, _: Ref<IShellItem>, result: HRESULT, recycled: Ref<IShellItem>) -> Result<()> {
        self.recycled.set(result.is_ok() && recycled.as_ref().is_some());
        Ok(())
    }
    fn StartOperations(&self) -> Result<()> { Ok(()) }
    fn FinishOperations(&self, _: HRESULT) -> Result<()> { Ok(()) }
    fn PreRenameItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR) -> Result<()> { Ok(()) }
    fn PostRenameItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR, _: HRESULT, _: Ref<IShellItem>) -> Result<()> { Ok(()) }
    fn PreMoveItem(&self, _: u32, _: Ref<IShellItem>, _: Ref<IShellItem>, _: &PCWSTR) -> Result<()> { Ok(()) }
    fn PostMoveItem(&self, _: u32, _: Ref<IShellItem>, _: Ref<IShellItem>, _: &PCWSTR, _: HRESULT, _: Ref<IShellItem>) -> Result<()> { Ok(()) }
    fn PreCopyItem(&self, _: u32, _: Ref<IShellItem>, _: Ref<IShellItem>, _: &PCWSTR) -> Result<()> { Ok(()) }
    fn PostCopyItem(&self, _: u32, _: Ref<IShellItem>, _: Ref<IShellItem>, _: &PCWSTR, _: HRESULT, _: Ref<IShellItem>) -> Result<()> { Ok(()) }
    fn PreNewItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR) -> Result<()> { Ok(()) }
    fn PostNewItem(&self, _: u32, _: Ref<IShellItem>, _: &PCWSTR, _: &PCWSTR, _: u32, _: HRESULT, _: Ref<IShellItem>) -> Result<()> { Ok(()) }
    fn UpdateProgress(&self, _: u32, _: u32) -> Result<()> { Ok(()) }
    fn ResetTimer(&self) -> Result<()> { Ok(()) }
    fn PauseTimer(&self) -> Result<()> { Ok(()) }
    fn ResumeTimer(&self) -> Result<()> { Ok(()) }
}

pub(super) fn recycle(path: &[u16], still_selected: impl Fn() -> bool + 'static) -> Result<bool> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let result = (|| {
            let operation: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_ALL)?;
            operation.SetOperationFlags(FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE | FOFX_ADDUNDORECORD | FOF_NO_UI)?;
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(path.as_ptr()), None)?;
            let guard = ComObject::new(RecycleOnly { recycled: Cell::new(false), still_selected: Box::new(still_selected) });
            let sink: IFileOperationProgressSink = guard.to_interface();
            operation.DeleteItem(&item, &sink)?;
            operation.PerformOperations()?;
            Ok(!operation.GetAnyOperationsAborted()?.as_bool() && guard.recycled.get())
        })();
        CoUninitialize();
        result
    }
}
