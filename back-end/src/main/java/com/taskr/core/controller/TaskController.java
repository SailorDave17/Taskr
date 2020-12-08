package com.taskr.core.controller;


import com.taskr.core.model.Task;
import com.taskr.core.storage.TaskStorage;
import com.taskr.core.storage.TaskTemplateStorage;
import com.taskr.core.storage.UserStorage;
import org.springframework.web.bind.annotation.*;

@RestController
public class TaskController {

    private TaskStorage taskStorage;
    private UserStorage userStorage;
    private TaskTemplateStorage taskTemplateStorage;

    public TaskController(TaskStorage taskStorage, UserStorage userStorage, TaskTemplateStorage taskTemplateStorage){
        this.taskStorage = taskStorage;
        this.userStorage = userStorage;
        this.taskTemplateStorage = taskTemplateStorage;
    }

    @GetMapping("/api/task/{id}")
    public Task retrieveTaskById(@PathVariable Long id){
        return  taskStorage.findById(id);
    }

    @PatchMapping("/api/task/{id}/update")
    public Iterable<Task> updateTaskInfo(@PathVariable Long id, @RequestBody Task task){
        Task existingTask =  retrieveTaskById(id);
        if(task.getDescription() != null){
            existingTask.setDescription(task.getDescription());
        }
        if (task.getDueBy() != null){
            existingTask.setDueBy(task.getDueBy());
        }
        if (task.getMinutesExpectedToComplete() != null){
            existingTask.setMinutesExpectedToComplete(task.getMinutesExpectedToComplete());
        }
        if (task.isDone() != null){
            existingTask.setDone(task.isDone());
        }
        if(task.getTitle() != null){
            existingTask.setTitle(task.getTitle());
        }
        if (task.getActualWorkTime() != null){
            existingTask.setActualWorkTime(task.getActualWorkTime());
        }
        if (task.getOwnedBy() != null){
            existingTask.setOwnedBy(task.getOwnedBy());
        }
        return taskStorage.findAll();
    }

    @GetMapping("/api/tasks")
    public Iterable<Task> getAllTasks(){
        return taskStorage.findAll();
    }
}
