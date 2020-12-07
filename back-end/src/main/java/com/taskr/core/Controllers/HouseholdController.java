package com.taskr.core.Controllers;


import com.taskr.core.Resources.Task;
import com.taskr.core.Resources.TaskTemplate;
import com.taskr.core.Resources.User;
import com.taskr.core.Storages.TaskStorage;
import com.taskr.core.Storages.TaskTemplateStorage;
import com.taskr.core.Storages.UserStorage;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Set;

@RestController
public class HouseholdController {

    private UserStorage userStorage;
    private TaskTemplateStorage taskTemplateStorage;
    private TaskStorage taskStorage;
    public HouseholdController(TaskStorage taskStorage, UserStorage userStorage, TaskTemplateStorage taskTemplateStorage) {
        this.userStorage = userStorage;
        this.taskTemplateStorage = taskTemplateStorage;
        this.taskStorage = taskStorage;
    }

    @GetMapping("/api/household")
    public Iterable<User> retrieveAllHousehold(){
        return userStorage.findAll();
    }

    @GetMapping("/api/household/tasks")
    public Iterable<TaskTemplate> retrieveAllHouseholdTasks(){
        return taskTemplateStorage.findAll();
    }

    @PostMapping("/api/household/new_household_task")
    public TaskTemplate createNewHouseholdTask(TaskTemplate taskTemplate){
        taskTemplateStorage.save(taskTemplate);
        return taskTemplate;
    }

    @GetMapping("/api/household/delete_household_task/{id}")
    public Iterable<TaskTemplate> deleteTaskFromHousehold(@PathVariable Long id){
        taskStorage.deleteByTemplateId(id);
        taskTemplateStorage.deleteById(id);
        return taskTemplateStorage.findAll();
    }

    @PatchMapping("/api/household/update_household_task/{id}")
    public TaskTemplate updateExistingHouseholdTask(@PathVariable Long id, @RequestBody TaskTemplate taskTemplate){
        TaskTemplate existingTaskTemplate = taskTemplateStorage.findById(id);
        if(taskTemplate.getActualWorkTime() != null){
            existingTaskTemplate.setActualWorkTime(taskTemplate.getActualWorkTime());
        }
        if(taskTemplate.getMinutesExpectedToComplete() != null){
            existingTaskTemplate.setMinutesExpectedToComplete(taskTemplate.getMinutesExpectedToComplete());
        }
        if(taskTemplate.getName() != null){
            existingTaskTemplate.setName(taskTemplate.getName());
        }
        if(taskTemplate.getDescription() != null){
            existingTaskTemplate.setDescription(taskTemplate.getDescription());
        }
        if(taskTemplate.getUsersWhoCannotDoThisTask() != null){
            existingTaskTemplate.setUsersWhoCannotDoThisTask(taskTemplate.getUsersWhoCannotDoThisTask());
        }
        taskTemplateStorage.save(existingTaskTemplate);
        taskStorage.updateAllTasksBasedOnTemplate(existingTaskTemplate.getId());
        return existingTaskTemplate;
    }

    @PostMapping("/api/household/assign_tasks")
    public Iterable<Task> assignTasks(@RequestBody Iterable<TaskTemplate> taskTemplateList){
        taskTemplateStorage.allocateTasks((Set<TaskTemplate>) taskTemplateList);
        return taskStorage.findAll();
    }

    @PostMapping("/api/household/assign_all_tasks")
    public Iterable<Task> assignAllTasks(){
        taskTemplateStorage.allocateAllTasks();
        return taskStorage.findAll();
    }
}
