package com.taskr.core;

import com.taskr.core.controller.UserController;
import com.taskr.core.model.User;
import com.taskr.core.storage.TaskStorage;
import com.taskr.core.storage.TaskTemplateStorage;
import com.taskr.core.storage.UserStorage;
import org.junit.jupiter.api.Test;

import java.util.Collections;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;


public class UserControllerTest {
//    private UserStorage userStorage;

    @Test
    public void shouldHaveAMethodToRetrieveAllUsers() {
        UserStorage userStorage = mock(UserStorage.class);
        TaskStorage taskStorage = mock(TaskStorage.class);
        TaskTemplateStorage taskTemplateStorage = mock(TaskTemplateStorage.class);
        UserController underTest = new UserController(userStorage, taskTemplateStorage, taskStorage);
        User testUser = new User("Aloo");
        userStorage.save(testUser);
        when(userStorage.findAll()).thenReturn(Collections.singletonList(testUser));
        Iterable<User> users = underTest.retrieveAllUsers();
        assertThat(users).contains(testUser);
    }

    @Test
    public void shouldHaveAMethodToSaveUser() {
        UserStorage userStorage = mock(UserStorage.class);
        TaskStorage taskStorage = mock(TaskStorage.class);
        TaskTemplateStorage taskTemplateStorage = mock(TaskTemplateStorage.class);
        UserController underTest = new UserController(userStorage, taskTemplateStorage, taskStorage);
        User testUser = new User("Aloo");
        underTest.addNewUser(testUser);
        when(userStorage.findAll()).thenReturn(Collections.singletonList(testUser));
        Iterable<User> users = underTest.retrieveAllUsers();
        assertThat(users).contains(testUser);
    }

    @Test
    public void shouldHaveAMethodToRetrieveSingleUser() {
        UserStorage userStorage = mock(UserStorage.class);
        TaskStorage taskStorage = mock(TaskStorage.class);
        TaskTemplateStorage taskTemplateStorage = mock(TaskTemplateStorage.class);
        UserController underTest = new UserController(userStorage, taskTemplateStorage, taskStorage);
        User testUser = new User("Aloo");
        underTest.addNewUser(testUser);
        when(userStorage.findById(1L)).thenReturn(testUser);
        User user = underTest.retrieveUserById(1L);
        assertThat(user).isEqualTo(testUser);
    }
}
