package com.taskr.core.Controllers;


import com.taskr.core.Resources.User;
import com.taskr.core.Storages.TaskTemplateStorage;
import com.taskr.core.Storages.UserStorage;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HouseholdController {

    private UserStorage userStorage;
    private TaskTemplateStorage taskTemplateStorage;
    public HouseholdController(UserStorage userStorage, TaskTemplateStorage taskTemplateStorage) {
        this.userStorage = userStorage;
        this.taskTemplateStorage = taskTemplateStorage;
    }

    @GetMapping("/api/household")
    public Iterable<User> retrieveAllHousehold(){
        return userStorage.findAll();
    }
}
